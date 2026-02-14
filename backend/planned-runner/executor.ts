import type { ExecutorContext, PlannedTransitionStep, StepExecutionResult, StepExecutor } from './types'

export class StubStepExecutor implements StepExecutor {
  async execute(step: PlannedTransitionStep, _context: ExecutorContext): Promise<StepExecutionResult> {
    void _context
    const validationResults = (step.validations ?? []).map((label, index) => ({
      id: `${step.edgeId}.v.${index + 1}`,
      label,
      status: 'pass' as const,
      reason: 'stub: assumed pass',
    }))

    return {
      result: 'pass',
      validationResults,
    }
  }
}
