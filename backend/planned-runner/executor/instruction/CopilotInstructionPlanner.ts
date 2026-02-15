import { CopilotClient } from '@github/copilot-sdk'
import { createLogger } from '../../../common/logger'
import type { ExecutorContext, PlannedTransitionStep, StepAssertionSpec, StepInstruction } from '../../types'
import type { InstructionPlanner } from '../contracts'
import { extractJsonPayload, normalizeActionType, normalizeAssertionType } from './shared'

const log = createLogger('planned-executor')

export class CopilotInstructionPlanner implements InstructionPlanner {
  private readonly model: string
  private readonly token: string | null
  private readonly cliPath?: string
  private readonly cliUrl?: string
  private readonly timeoutMs: number

  constructor() {
    this.model = process.env.PLANNED_RUNNER_INSTRUCTION_MODEL ?? process.env.COPILOT_MODEL ?? 'gpt-5'
    this.token = process.env.GITHUB_TOKEN ?? null
    this.cliPath = process.env.COPILOT_CLI_PATH || undefined
    this.cliUrl = process.env.COPILOT_CLI_URL || undefined
    const timeout = Number(process.env.PLANNED_RUNNER_INSTRUCTION_TIMEOUT_MS ?? 120000)
    this.timeoutMs = Number.isFinite(timeout) && timeout > 0 ? timeout : 120000
  }

  private systemPrompt(): string {
    return `你是一個 E2E 測試步驟規劃器。你必須把單一 transition step 轉成可執行的結構化指令。
只輸出 JSON，禁止 markdown。

輸出格式：
{
  "instruction": {
    "summary": "string",
    "intent": "string",
    "maxIterations": number,
    "actions": [
      {
        "action": "goto|click|type|press|select|wait|scroll|custom",
        "description": "string",
        "target": "可選，不要放語意推斷文字",
        "value": "必填 JSON 字串，描述工具參數。例: {"tool":"click_at","x":420,"y":260}"
      }
    ],
    "successCriteria": ["string"]
  },
  "assertions": [
    {
      "id": "string",
      "type": "url-equals|url-includes|text-visible|text-not-visible|element-visible|element-not-visible|network-success|network-failed|semantic-check",
      "description": "string",
      "expected": "string 可選",
      "selector": "string 可選",
      "timeoutMs": number 可選
    }
  ]
}

規則：
1) actions 只允許工具導向，不可做元素猜測，不可用「點擊登入按鈕」這種語意描述當參數。
2) action.value 必須是 JSON 字串，並明確提供工具參數；優先用 tool=
  click_at | hover_at | type_text_at | scroll_document | scroll_at | wait_5_seconds | go_back | go_forward | navigate | key_combination | drag_and_drop | current_state | evaluate。
  evaluate 用法：{"tool":"evaluate","mode":"expression","script":"window.scrollBy(0, 800)"}
  或 {"tool":"evaluate","mode":"function","script":"(arg) => { ... }","arg": {...}}。
3) assertions 必須可驗證，優先把 validation 轉成 url/text/element 類型。
4) maxIterations 建議 3~6。
5) 不可輸出空 actions。`
  }

  async build(
    step: PlannedTransitionStep,
    context: ExecutorContext,
  ): Promise<{ instruction: StepInstruction; assertions: StepAssertionSpec[] }> {
    if (!this.token) {
      throw new Error('GITHUB_TOKEN is required for CopilotInstructionPlanner')
    }

    const payload = {
      step: {
        id: step.id,
        edgeId: step.edgeId,
        fromStateId: step.fromStateId,
        toStateId: step.toStateId,
        fromDiagramId: step.fromDiagramId,
        toDiagramId: step.toDiagramId,
        label: step.label,
        semantic: step.semantic,
        validations: step.validations,
      },
      context: {
        runId: context.runId,
        pathId: context.pathId,
        pathName: context.pathName,
        semanticGoal: context.semanticGoal,
        targetUrl: context.targetUrl,
      },
    }

    const client = new CopilotClient({
      githubToken: this.token,
      cliPath: this.cliPath,
      cliUrl: this.cliUrl,
      autoStart: false,
    })

    try {
      await client.start()
      const session = await client.createSession({
        model: this.model,
        systemMessage: { content: this.systemPrompt() },
      })

      const finalEvent = await session.sendAndWait(
        {
          prompt: `Return JSON only.\n${JSON.stringify(payload)}`,
        },
        this.timeoutMs,
      )

      await session.destroy()
      await client.stop()

      const content = finalEvent?.data?.content ?? ''
      const parsed = extractJsonPayload(content)
      const rawActions = parsed?.instruction?.actions ?? []
      const rawAssertions = parsed?.assertions ?? []

      const actions = rawActions
        .map((item) => ({
          action: normalizeActionType(item.action),
          description: item.description?.trim() || 'perform action',
          target: item.target?.trim() || undefined,
          value: item.value?.trim() || undefined,
        }))
        .filter((item) => item.description.length > 0)

      if (actions.length === 0) {
        throw new Error('CopilotInstructionPlanner produced empty actions')
      }

      const assertions: StepAssertionSpec[] = rawAssertions.map((assertion, index) => ({
        id: assertion.id?.trim() || `${step.edgeId}.assertion.${index + 1}`,
        type: normalizeAssertionType(assertion.type),
        description: assertion.description?.trim() || step.validations[index] || `assertion ${index + 1}`,
        expected: assertion.expected?.trim() || undefined,
        selector: assertion.selector?.trim() || undefined,
        timeoutMs: assertion.timeoutMs && assertion.timeoutMs > 0 ? assertion.timeoutMs : 5000,
      }))

      const instruction: StepInstruction = {
        summary: parsed?.instruction?.summary?.trim() || `完成狀態轉換 ${step.fromStateId} -> ${step.toStateId}`,
        intent: parsed?.instruction?.intent?.trim() || step.semantic,
        actions,
        successCriteria:
          parsed?.instruction?.successCriteria?.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) ||
          assertions.map((item) => item.description),
        maxIterations:
          parsed?.instruction?.maxIterations && parsed.instruction.maxIterations > 0
            ? Math.min(Math.max(parsed.instruction.maxIterations, 1), 8)
            : 4,
      }

      return {
        instruction,
        assertions:
          assertions.length > 0
            ? assertions
            : context.stepValidations.map((validation, index) => ({
                id: `${step.edgeId}.assertion.${index + 1}`,
                type: 'semantic-check',
                description: validation,
                expected: validation,
                timeoutMs: 5000,
              })),
      }
    } catch (error) {
      log.log('copilot instruction planner failed', {
        model: this.model,
        error: error instanceof Error ? error.message : 'instruction planning error',
      })
      try {
        await client.forceStop()
      } catch {
        // ignore
      }
      throw error instanceof Error ? error : new Error('instruction planning error')
    }
  }
}
