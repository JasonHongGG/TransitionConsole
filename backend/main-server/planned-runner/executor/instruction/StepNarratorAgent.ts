import { CopilotClient } from '@github/copilot-sdk'
import { createLogger } from '../../../common/logger'
import type {
  ExecutorContext,
  PlannedTransitionStep,
  StepCompletionCriterion,
  StepNarrativeInstruction,
} from '../../types'
import type { StepNarrator } from '../contracts'
import { extractJsonPayload } from './shared'

const log = createLogger('planned-executor')

type NarrativeEnvelope = {
  narrative?: {
    summary?: string
    taskDescription?: string
    maxIterations?: number
  }
  completionCriteria?: Array<{
    id?: string
    type?: string
    description?: string
    expected?: string
    selector?: string
  }>
}

const allowedTypes = new Set<StepCompletionCriterion['type']>([
  'url-equals',
  'url-includes',
  'text-visible',
  'element-visible',
  'semantic-check',
])

export class StepNarratorAgent implements StepNarrator {
  private readonly model: string
  private readonly token: string | null
  private readonly cliPath?: string
  private readonly cliUrl?: string
  private readonly timeoutMs: number

  constructor() {
    this.model = process.env.PLANNED_RUNNER_NARRATIVE_MODEL ?? process.env.AI_RUNTIME_MODEL ?? 'gpt-5'
    this.token = process.env.GITHUB_TOKEN ?? null
    this.cliPath = process.env.AI_RUNTIME_CLI_PATH || undefined
    this.cliUrl = process.env.AI_RUNTIME_CLI_URL || undefined
    const timeout = Number(process.env.PLANNED_RUNNER_NARRATIVE_TIMEOUT_MS ?? 120000)
    this.timeoutMs = Number.isFinite(timeout) && timeout > 0 ? timeout : 120000
  }

  private buildFallback(step: PlannedTransitionStep, context: ExecutorContext): StepNarrativeInstruction {
    const completionCriteria: StepCompletionCriterion[] = context.stepValidations.map((validation, index) => ({
      id: `${step.edgeId}.criteria.${index + 1}`,
      type: 'semantic-check',
      description: validation,
      expected: validation,
    }))

    return {
      summary: `${step.fromStateId} -> ${step.toStateId}`,
      taskDescription: `完成狀態轉換：${step.label}`,
      completionCriteria,
      maxIterations: 6,
    }
  }

  private systemPrompt(): string {
    return `你是 UI transition 任務敘述代理（Step Narrator）。
你會收到單一步驟與 system view 圖表資訊，請輸出當前這步在真實網頁上要完成的「任務敘述」與「完成條件」。
只輸出 JSON，禁止 markdown。

格式：
{
  "narrative": {
    "summary": "string",
    "taskDescription": "string",
    "maxIterations": number
  },
  "completionCriteria": [
    {
      "id": "string",
      "type": "url-equals|url-includes|text-visible|element-visible|semantic-check",
      "description": "string",
      "expected": "string 可選",
      "selector": "string 可選"
    }
  ]
}

規則：
1) taskDescription 要具體且可執行，描述這一步在頁面上要達成的目標。
2) completionCriteria 要可驗證，優先使用 url/text/element，不足時才 semantic-check。
3) maxIterations 建議 4~12。`
  }

  async generate(step: PlannedTransitionStep, context: ExecutorContext): Promise<StepNarrativeInstruction> {
    if (!this.token) {
      return this.buildFallback(step, context)
    }

    const client = new CopilotClient({
      githubToken: this.token,
      cliPath: this.cliPath,
      cliUrl: this.cliUrl,
      autoStart: false,
    })

    const payload = {
      step,
      context: {
        runId: context.runId,
        pathId: context.pathId,
        pathName: context.pathName,
        semanticGoal: context.semanticGoal,
        stepValidations: context.stepValidations,
        currentPathStepIndex: context.currentPathStepIndex,
        currentPathStepTotal: context.currentPathStepTotal,
        pathEdgeIds: context.pathEdgeIds,
        diagrams: context.systemDiagrams,
        connectors: context.systemConnectors,
      },
    }

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

      const parsed = extractJsonPayload(finalEvent?.data?.content ?? '') as NarrativeEnvelope | null
      const rawCriteria = parsed?.completionCriteria ?? []

      const completionCriteria: StepCompletionCriterion[] = rawCriteria
        .map((criterion, index) => {
          const normalizedType = (criterion.type?.trim() || 'semantic-check') as StepCompletionCriterion['type']
          return {
            id: criterion.id?.trim() || `${step.edgeId}.criteria.${index + 1}`,
            type: allowedTypes.has(normalizedType) ? normalizedType : 'semantic-check',
            description: criterion.description?.trim() || context.stepValidations[index] || `criteria ${index + 1}`,
            expected: criterion.expected?.trim() || undefined,
            selector: criterion.selector?.trim() || undefined,
          }
        })
        .filter((criterion) => criterion.description.length > 0)

      return {
        summary: parsed?.narrative?.summary?.trim() || `${step.fromStateId} -> ${step.toStateId}`,
        taskDescription: parsed?.narrative?.taskDescription?.trim() || `完成狀態轉換：${step.label}`,
        completionCriteria:
          completionCriteria.length > 0
            ? completionCriteria
            : context.stepValidations.map((validation, index) => ({
                id: `${step.edgeId}.criteria.${index + 1}`,
                type: 'semantic-check',
                description: validation,
                expected: validation,
              })),
        maxIterations:
          parsed?.narrative?.maxIterations && parsed.narrative.maxIterations > 0
            ? Math.min(Math.max(parsed.narrative.maxIterations, 1), 20)
            : 8,
      }
    } catch (error) {
      log.log('step narrator failed; using fallback', {
        model: this.model,
        error: error instanceof Error ? error.message : 'narrator error',
      })
      try {
        await client.forceStop()
      } catch {
        // ignore
      }
      return this.buildFallback(step, context)
    }
  }
}
