import type { AiRuntime } from '../../runtime/types'
import { VALIDATION_TYPES } from '../../../main-server/planned-runner/types'
import type { StepValidationSpec, StepNarrativeInstruction } from '../../../main-server/planned-runner/types'
import type { StepNarratorGenerateRequest } from '../../../main-server/type/contracts'
import { writeAgentResponseLog } from '../../common/agentResponseLog'
import { extractJsonPayload } from '../../common/json'
import type { StepNarratorAgent as StepNarratorAgentContract } from '../types'
import { STEP_NARRATOR_PROMPT } from './prompt'
import { StepNarratorMockReplay } from './mockReplay/StepNarratorMockReplay'

type NarrativePayload = {
  narrative?: {
    summary?: string
    taskDescription?: string
  }
  validations?: Array<{
    id?: string
    type?: string
    description?: string
    expected?: string
    selector?: string
    timeoutMs?: number
  }>
}

const allowedTypes = new Set<StepValidationSpec['type']>(VALIDATION_TYPES)

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

  private collectValidationHints(input: StepNarratorGenerateRequest): string[] {
    const { step, context } = input
    const hints = new Set<string>()

    context.diagrams.forEach((diagram) => {
      diagram.transitions
        .filter((transition) => transition.id === step.edgeId)
        .forEach((transition) => {
          ;(transition.validations ?? []).forEach((item) => {
            const text = item.description?.trim() ?? ''
            if (text) hints.add(text)
          })
          const intentSummary = transition.intent?.summary?.trim()
          if (intentSummary) {
            hints.add(`符合 transition intent：${intentSummary}`)
          }
        })

      diagram.connectors
        .filter((connector) => {
          const fromMatches =
            connector.from.diagramId === step.from.diagramId
            && (connector.from.stateId === null || connector.from.stateId === step.from.stateId)
          const toMatches =
            connector.to.diagramId === step.to.diagramId
            && (connector.to.stateId === null || connector.to.stateId === step.to.stateId)
          return fromMatches && toMatches
        })
        .forEach((connector) => {
          ;(connector.validations ?? []).forEach((item) => {
            const text = item.description?.trim() ?? ''
            if (text) hints.add(text)
          })
        })
    })

    return Array.from(hints)
  }

  private buildValidationsFromHints(step: StepNarratorGenerateRequest['step'], hints: string[]): StepValidationSpec[] {
    return hints.map((hint, index) => ({
      id: `${step.edgeId}.validation.${index + 1}`,
      type: 'semantic-check',
      description: hint,
      expected: hint,
    }))
  }

  private defaultSummary(step: StepNarratorGenerateRequest['step']): string {
    return `${step.from.stateId} -> ${step.to.stateId}`
  }

  private defaultTaskDescription(step: StepNarratorGenerateRequest['step']): string {
    return `完成狀態轉換：${step.summary ?? step.semanticGoal ?? step.edgeId}`
  }

  async generate(input: StepNarratorGenerateRequest): Promise<StepNarrativeInstruction> {
    const { step, context } = input

    if (this.useMockReplay) {
      const output = await this.mockReplay.generateNarrative()

      await writeAgentResponseLog({
        agent: 'step-narrator',
        model: this.model,
        mode: 'mock-replay',
        runId: context.runId,
        pathId: context.pathId,
        stepId: context.stepId,
        request: input,
        parsedResponse: {
          narrative: output,
        },
      })

      return output
    }

    const content = await this.runtime.generate({
      model: this.model,
      systemPrompt: STEP_NARRATOR_PROMPT,
      prompt: `Return JSON only.\n${JSON.stringify(input)}`,
      timeoutMs: this.timeoutMs,
    })

    const parsed = extractJsonPayload<NarrativePayload>(content)
    const validationFallbackHints = this.collectValidationHints(input)
    const validations = (parsed?.validations ?? [])
      .map((validation, index) => {
        const normalizedType = (validation.type?.trim() || 'semantic-check') as StepValidationSpec['type']
        return {
          id: validation.id?.trim() || `${step.edgeId}.validation.${index + 1}`,
          type: allowedTypes.has(normalizedType) ? normalizedType : 'semantic-check',
          description: validation.description?.trim() || validationFallbackHints[index] || `validation ${index + 1}`,
          expected: validation.expected?.trim() || undefined,
          selector: validation.selector?.trim() || undefined,
          timeoutMs: validation.timeoutMs && validation.timeoutMs > 0 ? validation.timeoutMs : undefined,
        }
      })
      .filter((validation) => validation.description.length > 0)

    const output = {
      summary: parsed?.narrative?.summary?.trim() || this.defaultSummary(step),
      taskDescription: parsed?.narrative?.taskDescription?.trim() || this.defaultTaskDescription(step),
      validations:
        validations.length > 0
          ? validations
          : this.buildValidationsFromHints(
              step,
              validationFallbackHints.length > 0 ? validationFallbackHints : [this.defaultTaskDescription(step)],
            ),
    }

    await writeAgentResponseLog({
      agent: 'step-narrator',
      model: this.model,
      runId: context.runId,
      pathId: context.pathId,
      stepId: context.stepId,
      request: input,
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
