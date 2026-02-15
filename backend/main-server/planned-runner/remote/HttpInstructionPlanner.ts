import type { ExecutorContext, PlannedTransitionStep, StepAssertionSpec, StepInstruction } from '../types'
import type { InstructionPlanner } from '../executor/contracts'
import type { InstructionPlannerBuildRequest, InstructionPlannerBuildResponse } from '../../shared/contracts'
import { postJson } from './httpClient'

export class HttpInstructionPlanner implements InstructionPlanner {
  private readonly aiBaseUrl: string
  private readonly timeoutMs: number

  constructor(options?: { aiBaseUrl?: string; timeoutMs?: number }) {
    this.aiBaseUrl = options?.aiBaseUrl ?? process.env.AI_SERVER_BASE_URL ?? 'http://localhost:7081'
    this.timeoutMs = options?.timeoutMs ?? Number(process.env.AI_SERVER_TIMEOUT_MS ?? 120000)
  }

  async build(
    step: PlannedTransitionStep,
    context: ExecutorContext,
  ): Promise<{ instruction: StepInstruction; assertions: StepAssertionSpec[] }> {
    return postJson<InstructionPlannerBuildRequest, InstructionPlannerBuildResponse>(
      this.aiBaseUrl,
      '/api/ai/agents/instruction-planner/build',
      { step, context },
      this.timeoutMs,
    )
  }
}
