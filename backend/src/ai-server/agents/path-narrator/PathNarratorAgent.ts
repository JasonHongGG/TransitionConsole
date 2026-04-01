import type { AiRuntime } from '../../runtime/types'
import type { AgentMode } from '../../../main-server/planned-runner/types'
import { VALIDATION_TYPES } from '../../../main-server/planned-runner/types'
import type {
  PathNarrativeTransitionInstruction,
  StepValidationSpec,
  StepNarrativeInstruction,
} from '../../../main-server/planned-runner/types'
import type { PathNarratorGenerateRequest } from '../../../main-server/type/contracts'
import { writeAgentResponseLog } from '../../common/agentResponseLog'
import { extractJsonPayload } from '../../common/json'
import type { PathNarratorAgent as PathNarratorAgentContract } from '../types'
import { PATH_NARRATOR_PROMPT } from './prompt'
import { PathNarratorMockReplay } from './mockReplay/PathNarratorMockReplay'

type NarrativePayload = {
  narrative?: {
    summary?: string
    taskDescription?: string
    executionStrategy?: string
  }
  transitions?: Array<{
    stepId?: string
    summary?: string
    taskDescription?: string
    validations?: Array<{
      id?: string
      type?: string
      description?: string
      expected?: string
      selector?: string
      timeoutMs?: number
    }>
  }>
}

const allowedTypes = new Set<StepValidationSpec['type']>(VALIDATION_TYPES)

export class DefaultPathNarratorAgent implements PathNarratorAgentContract {
  private readonly runtime: AiRuntime
  private readonly model: string
  private readonly timeoutMs: number
  private readonly defaultMode: AgentMode
  private readonly mockReplay: PathNarratorMockReplay

  constructor(runtime: AiRuntime) {
    this.runtime = runtime
    this.model = process.env.PATH_NARRATOR_MODEL ?? process.env.AI_RUNTIME_MODEL ?? 'gpt-5'
    this.timeoutMs = Number(process.env.PATH_NARRATOR_TIMEOUT_MS ?? process.env.AI_RUNTIME_TIMEOUT_MS ?? 180000)
    this.defaultMode = (process.env.PATH_NARRATOR_PROVIDER ?? 'llm').trim().toLowerCase() === 'mock-replay' ? 'mock' : 'llm'
    this.mockReplay = new PathNarratorMockReplay({
      mockDir: process.env.PATH_NARRATOR_MOCK_DIR,
      loop: (process.env.PATH_NARRATOR_MOCK_LOOP ?? 'true').trim().toLowerCase() !== 'false',
    })
  }

  private collectValidationHints(input: PathNarratorGenerateRequest, stepId: string): string[] {
    const step = input.path.steps.find((item) => item.id === stepId)
    if (!step) return []

    const hints = new Set<string>()

    input.context.diagrams.forEach((diagram) => {
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
        .filter((connector) => connector.id === step.edgeId)
        .forEach((connector) => {
          ;(connector.validations ?? []).forEach((item) => {
            const text = item.description?.trim() ?? ''
            if (text) hints.add(text)
          })
        })
    })

    return Array.from(hints)
  }

  private buildFallbackTransition(step: PathNarratorGenerateRequest['path']['steps'][number], hints: string[]): PathNarrativeTransitionInstruction {
    const validations = (hints.length > 0 ? hints : step.validations?.map((item) => item.description) ?? [step.summary ?? step.edgeId]).map((hint, index) => ({
      id: `${step.edgeId}.validation.${index + 1}`,
      type: 'semantic-check' as const,
      description: hint,
      expected: hint,
    }))

    return {
      stepId: step.id,
      edgeId: step.edgeId,
      summary: step.summary ?? `${step.from.stateId} -> ${step.to.stateId}`,
      taskDescription: `完成此 transition 的主目標：${step.summary ?? step.semanticGoal ?? step.edgeId}。若直接控制暫時不存在，可先在同一 session 內建立立即前提，再回到這個 transition 完成主目標。`,
      validations,
    }
  }

  async generate(input: PathNarratorGenerateRequest): Promise<StepNarrativeInstruction> {
    const { path, context } = input
    const mode = input.context.agentMode ?? this.defaultMode

    if (mode === 'mock') {
      const output = await this.mockReplay.generateNarrative()

      await writeAgentResponseLog({
        agent: 'path-narrator',
        model: this.model,
        mode: 'mock-replay',
        runId: context.runId,
        pathId: context.pathId,
        request: input,
        parsedResponse: {
          narrative: output,
        },
      })

      return output
    }

    const content = await this.runtime.generate({
      model: this.model,
      systemPrompt: PATH_NARRATOR_PROMPT,
      prompt: `Return JSON only.\n${JSON.stringify(input)}`,
      timeoutMs: this.timeoutMs,
    })

    const parsed = extractJsonPayload<NarrativePayload>(content)
    const transitions: PathNarrativeTransitionInstruction[] = path.steps.map((step, index) => {
      const responseTransition = parsed?.transitions?.find((item) => item.stepId === step.id) ?? parsed?.transitions?.[index]
      const hintFallbacks = this.collectValidationHints(input, step.id)
      if (!responseTransition) {
        return this.buildFallbackTransition(step, hintFallbacks)
      }

      const validations = (responseTransition.validations ?? [])
        .map((validation, validationIndex) => {
          const normalizedType = (validation.type?.trim() || 'semantic-check') as StepValidationSpec['type']
          return {
            id: validation.id?.trim() || `${step.edgeId}.validation.${validationIndex + 1}`,
            type: allowedTypes.has(normalizedType) ? normalizedType : 'semantic-check',
            description: validation.description?.trim() || hintFallbacks[validationIndex] || `validation ${validationIndex + 1}`,
            expected: validation.expected?.trim() || undefined,
            selector: validation.selector?.trim() || undefined,
            timeoutMs: validation.timeoutMs && validation.timeoutMs > 0 ? validation.timeoutMs : undefined,
          }
        })
        .filter((validation) => validation.description.length > 0)

      return {
        stepId: step.id,
        edgeId: step.edgeId,
        summary: responseTransition.summary?.trim() || step.summary || `${step.from.stateId} -> ${step.to.stateId}`,
        taskDescription:
          responseTransition.taskDescription?.trim() ||
          `完成 path transition：${step.summary ?? step.semanticGoal ?? step.edgeId}`,
        validations: validations.length > 0 ? validations : this.buildFallbackTransition(step, hintFallbacks).validations,
      }
    })

    const output: StepNarrativeInstruction = {
      summary: parsed?.narrative?.summary?.trim() || path.semanticGoal || path.name,
      taskDescription: parsed?.narrative?.taskDescription?.trim() || `Execute path ${path.name}`,
      executionStrategy:
        parsed?.narrative?.executionStrategy?.trim() ||
        `Keep one browser session for the full path. Use path.actorHint as the actor identity reference when login or role-specific behavior is required. Let operator-loop use bounded exploratory actions only when it needs to establish the current transition's immediate prerequisite, recover the main line, or gather stronger evidence. Continue when the UI flow is still operable; if validations fail or remain pending, record the validation issues clearly and keep executing instead of blocking the path.`,
      validations: transitions.flatMap((transition) => transition.validations),
      transitions,
    }

    await writeAgentResponseLog({
      agent: 'path-narrator',
      model: this.model,
      runId: context.runId,
      pathId: context.pathId,
      request: input,
      rawResponse: content,
      parsedResponse: {
        narrative: output,
      },
    })

    return output
  }

  async reset(): Promise<void> {
    await this.mockReplay.resetRoundCursor()
  }
}