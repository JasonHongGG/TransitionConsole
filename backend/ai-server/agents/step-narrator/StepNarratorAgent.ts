import type { AiRuntime } from '../../runtime/types'
import type { ExecutorContext, PlannedTransitionStep, StepAssertionSpec, StepNarrativeInstruction } from '../../../main-server/planned-runner/types'
import { writeAgentResponseLog } from '../../common/agentResponseLog'
import { extractJsonPayload } from '../../common/json'
import type { StepNarratorAgent as StepNarratorAgentContract } from '../types'
import { STEP_NARRATOR_PROMPT } from './prompt'
import { StepNarratorMockReplay } from './mockReplay/StepNarratorMockReplay'

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

export class DefaultStepNarratorAgent implements StepNarratorAgentContract {
  private readonly runtime: AiRuntime
  private readonly model: string
  private readonly timeoutMs: number
  private readonly useMockReplay: boolean
  private readonly mockReplay: StepNarratorMockReplay

  constructor(runtime: AiRuntime) {
    this.runtime = runtime
    this.model = process.env.STEP_NARRATOR_MODEL ?? process.env.AI_RUNTIME_MODEL ?? 'gpt-5'
    this.timeoutMs = Number(process.env.STEP_NARRATOR_TIMEOUT_MS ?? process.env.AI_RUNTIME_TIMEOUT_MS ?? 180000)
    this.useMockReplay = (process.env.STEP_NARRATOR_PROVIDER ?? 'llm').trim().toLowerCase() === 'mock-replay'
    this.mockReplay = new StepNarratorMockReplay({
      mockDir: process.env.STEP_NARRATOR_MOCK_DIR,
      loop: (process.env.STEP_NARRATOR_MOCK_LOOP ?? 'true').trim().toLowerCase() !== 'false',
    })
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

  async generate(step: PlannedTransitionStep, context: ExecutorContext): Promise<StepNarrativeInstruction> {
    if (this.useMockReplay) {
      const payload = { step, context }
      const output = await this.mockReplay.generateNarrative()

      await writeAgentResponseLog({
        agent: 'step-narrator',
        model: this.model,
        mode: 'mock-replay',
        runId: context.runId,
        pathId: context.pathId,
        stepId: context.stepId,
        request: payload,
        parsedResponse: {
          narrative: output,
        },
      })

      return output
    }

    const payload = {
      step,
      context,
    }

    const content = await this.runtime.generate({
      model: this.model,
      systemPrompt: STEP_NARRATOR_PROMPT,
      prompt: `Return JSON only.\n${JSON.stringify(payload)}`,
      timeoutMs: this.timeoutMs,
    })

    const parsed = extractJsonPayload<NarrativeEnvelope>(content)
    const assertionFallbackHints = this.collectValidationHints(step, context)
    const assertions = (parsed?.assertions ?? [])
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

    const output = {
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

    await writeAgentResponseLog({
      agent: 'step-narrator',
      model: this.model,
      runId: context.runId,
      pathId: context.pathId,
      stepId: context.stepId,
      request: payload,
      rawResponse: content,
      parsedResponse: {
        narrative: output,
      },
    })

    return output
  }

  async reset(): Promise<void> {
    if (this.useMockReplay) {
      await this.mockReplay.resetRoundCursor()
    }
  }
}
