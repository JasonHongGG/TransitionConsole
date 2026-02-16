import { CopilotClient } from '@github/copilot-sdk'
import { createLogger } from '../../../common/logger'
import type {
  ExecutorContext,
  PlannedTransitionStep,
  StepAssertionSpec,
  StepNarrativeInstruction,
} from '../../types'
import type { StepNarrator } from '../contracts'
import { extractJsonPayload } from './shared'

const log = createLogger('planned-executor')

type NarrativeEnvelope = {
  narrative?: {
    summary?: string
    taskDescription?: string
  }
  assertions?: Array<{
    id?: string
    type?: string
    description?: string
    expected?: string
    selector?: string
    timeoutMs?: number
  }>
}

const allowedTypes = new Set<StepAssertionSpec['type']>([
  'url-equals',
  'url-includes',
  'text-visible',
  'text-not-visible',
  'element-visible',
  'element-not-visible',
  'network-success',
  'network-failed',
  'semantic-check',
])

export class StepNarratorAgent implements StepNarrator {
  private readonly model: string
  private readonly token: string | null
  private readonly cliPath?: string
  private readonly cliUrl?: string
  private readonly timeoutMs: number

  constructor() {
    this.model = process.env.STEP_NARRATOR_MODEL ?? process.env.AI_RUNTIME_MODEL ?? 'gpt-5'
    this.token = process.env.GITHUB_TOKEN ?? null
    this.cliPath = process.env.AI_RUNTIME_CLI_PATH || undefined
    this.cliUrl = process.env.AI_RUNTIME_CLI_URL || undefined
    this.timeoutMs = Number(process.env.STEP_NARRATOR_TIMEOUT_MS ?? process.env.AI_RUNTIME_TIMEOUT_MS ?? 180000)
  }

  private collectValidationHints(step: PlannedTransitionStep, context: ExecutorContext): string[] {
    const hints = new Set<string>()

    step.validations.forEach((item) => {
      const text = item.trim()
      if (text) hints.add(text)
    })

    context.stepValidations.forEach((item) => {
      const text = item.trim()
      if (text) hints.add(text)
    })

    context.systemDiagrams.forEach((diagram) => {
      diagram.transitions
        .filter((transition) => transition.id === step.edgeId)
        .forEach((transition) => {
          ;(transition.validations ?? []).forEach((item) => {
            const text = item.trim()
            if (text) hints.add(text)
          })
          const intentSummary = transition.intent?.summary?.trim()
          if (intentSummary) {
            hints.add(`符合 transition intent：${intentSummary}`)
          }
        })
    })

    context.systemConnectors
      .filter((connector) => {
        const fromMatches =
          connector.from.diagramId === step.fromDiagramId
          && (connector.from.stateId === null || connector.from.stateId === step.fromStateId)
        const toMatches =
          connector.to.diagramId === step.toDiagramId
          && (connector.to.stateId === null || connector.to.stateId === step.toStateId)
        return fromMatches && toMatches
      })
      .forEach((connector) => {
        ;(connector.meta?.validations ?? []).forEach((item) => {
          const text = item.trim()
          if (text) hints.add(text)
        })
      })

    return Array.from(hints)
  }

  private buildAssertionsFromHints(step: PlannedTransitionStep, hints: string[]): StepAssertionSpec[] {
    return hints.map((hint, index) => ({
      id: `${step.edgeId}.assertion.${index + 1}`,
      type: 'semantic-check',
      description: hint,
      expected: hint,
    }))
  }

  private buildFallback(step: PlannedTransitionStep, context: ExecutorContext): StepNarrativeInstruction {
    const hints = this.collectValidationHints(step, context)
    const assertions = this.buildAssertionsFromHints(
      step,
      hints.length > 0 ? hints : [`完成狀態轉換：${step.label}`],
    )

    return {
      summary: `${step.fromStateId} -> ${step.toStateId}`,
      taskDescription: `完成狀態轉換：${step.label}`,
      assertions,
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
    "taskDescription": "string"
  },
  "assertions": [
    {
      "id": "string",
      "type": "url-equals|url-includes|text-visible|text-not-visible|element-visible|element-not-visible|network-success|network-failed|semantic-check",
      "description": "string",
      "expected": "string 可選",
      "selector": "string 可選"
    }
  ]
}

規則：
1) taskDescription 要具體且可執行，描述這一步在頁面上要達成的目標。
2) assertions 要可驗證，且優先由本步 transition/connector validations 推導，不足時才 semantic-check。`
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
      const assertionFallbackHints = this.collectValidationHints(step, context)
      const rawAssertions = parsed?.assertions ?? []

      const assertions: StepAssertionSpec[] = rawAssertions
        .map((assertion, index) => {
          const normalizedType = (assertion.type?.trim() || 'semantic-check') as StepAssertionSpec['type']
          return {
            id: assertion.id?.trim() || `${step.edgeId}.assertion.${index + 1}`,
            type: allowedTypes.has(normalizedType) ? normalizedType : 'semantic-check',
            description: assertion.description?.trim() || assertionFallbackHints[index] || `assertion ${index + 1}`,
            expected: assertion.expected?.trim() || undefined,
            selector: assertion.selector?.trim() || undefined,
            timeoutMs: assertion.timeoutMs && assertion.timeoutMs > 0 ? assertion.timeoutMs : undefined,
          }
        })
        .filter((assertion) => assertion.description.length > 0)

      return {
        summary: parsed?.narrative?.summary?.trim() || `${step.fromStateId} -> ${step.toStateId}`,
        taskDescription: parsed?.narrative?.taskDescription?.trim() || `完成狀態轉換：${step.label}`,
        assertions:
          assertions.length > 0
            ? assertions
            : this.buildAssertionsFromHints(
                step,
                assertionFallbackHints.length > 0 ? assertionFallbackHints : [`完成狀態轉換：${step.label}`],
              ),
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
