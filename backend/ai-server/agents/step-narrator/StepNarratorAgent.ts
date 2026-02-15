import type { AiRuntime } from '../../runtime/types'
import type { ExecutorContext, PlannedTransitionStep, StepCompletionCriterion, StepNarrativeInstruction } from '../../../main-server/planned-runner/types'
import { extractJsonPayload } from '../../common/json'
import type { StepNarratorAgent as StepNarratorAgentContract } from '../types'
import { STEP_NARRATOR_PROMPT } from './prompt'

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

export class DefaultStepNarratorAgent implements StepNarratorAgentContract {
  private readonly runtime: AiRuntime
  private readonly model: string
  private readonly timeoutMs: number

  constructor(runtime: AiRuntime) {
    this.runtime = runtime
    this.model = process.env.PLANNED_RUNNER_NARRATIVE_MODEL ?? process.env.AI_RUNTIME_MODEL ?? 'gpt-5'
    this.timeoutMs = Number(process.env.PLANNED_RUNNER_NARRATIVE_TIMEOUT_MS ?? 120000)
  }

  async generate(step: PlannedTransitionStep, context: ExecutorContext): Promise<StepNarrativeInstruction> {
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
    const completionCriteria = (parsed?.completionCriteria ?? [])
      .map((criterion, index) => ({
        id: criterion.id?.trim() || `${step.edgeId}.criteria.${index + 1}`,
        type: allowedTypes.has((criterion.type?.trim() || 'semantic-check') as StepCompletionCriterion['type'])
          ? ((criterion.type?.trim() || 'semantic-check') as StepCompletionCriterion['type'])
          : 'semantic-check',
        description: criterion.description?.trim() || context.stepValidations[index] || `criteria ${index + 1}`,
        expected: criterion.expected?.trim() || undefined,
        selector: criterion.selector?.trim() || undefined,
      }))
      .filter((criterion) => criterion.description.length > 0)

    return {
      summary: parsed?.narrative?.summary?.trim() || `${step.fromStateId} -> ${step.toStateId}`,
      taskDescription: parsed?.narrative?.taskDescription?.trim() || `完成狀態轉換：${step.label}`,
      completionCriteria,
      maxIterations:
        parsed?.narrative?.maxIterations && parsed.narrative.maxIterations > 0
          ? Math.min(Math.max(parsed.narrative.maxIterations, 1), 20)
          : 8,
    }
  }
}
