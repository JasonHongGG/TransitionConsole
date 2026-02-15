import type { AiRuntime } from '../../runtime/types'
import type { ExecutorContext, PlannedTransitionStep, StepAssertionSpec, StepInstruction } from '../../../main-server/planned-runner/types'
import { extractJsonPayload } from '../../common/json'
import type { CopilotInstructionEnvelope } from '../../../main-server/planned-runner/executor/contracts'
import { normalizeActionType, normalizeAssertionType } from '../../../main-server/planned-runner/executor/instruction/shared'
import type { InstructionPlannerAgent as InstructionPlannerAgentContract } from '../types'
import { INSTRUCTION_PLANNER_PROMPT } from './prompt'

export class DefaultInstructionPlannerAgent implements InstructionPlannerAgentContract {
  private readonly runtime: AiRuntime
  private readonly model: string
  private readonly timeoutMs: number

  constructor(runtime: AiRuntime) {
    this.runtime = runtime
    this.model = process.env.PLANNED_RUNNER_INSTRUCTION_MODEL ?? process.env.AI_RUNTIME_MODEL ?? 'gpt-5'
    this.timeoutMs = Number(process.env.PLANNED_RUNNER_INSTRUCTION_TIMEOUT_MS ?? 120000)
  }

  async build(
    step: PlannedTransitionStep,
    context: ExecutorContext,
  ): Promise<{ instruction: StepInstruction; assertions: StepAssertionSpec[] }> {
    const payload = { step, context }

    const content = await this.runtime.generate({
      model: this.model,
      systemPrompt: INSTRUCTION_PLANNER_PROMPT,
      prompt: `Return JSON only.\n${JSON.stringify(payload)}`,
      timeoutMs: this.timeoutMs,
    })

    const parsed = extractJsonPayload<CopilotInstructionEnvelope>(content)
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

    const assertions: StepAssertionSpec[] = rawAssertions.map((assertion, index) => ({
      id: assertion.id?.trim() || `${step.edgeId}.assertion.${index + 1}`,
      type: normalizeAssertionType(assertion.type),
      description: assertion.description?.trim() || step.validations[index] || `assertion ${index + 1}`,
      expected: assertion.expected?.trim() || undefined,
      selector: assertion.selector?.trim() || undefined,
      timeoutMs: assertion.timeoutMs && assertion.timeoutMs > 0 ? assertion.timeoutMs : 5000,
    }))

    return {
      instruction: {
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
      },
      assertions,
    }
  }
}
