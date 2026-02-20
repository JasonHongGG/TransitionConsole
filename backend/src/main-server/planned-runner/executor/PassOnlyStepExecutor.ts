import { createLogger } from '../../common/logger'
import type {
  ExecutorContext,
  PlannedTransitionStep,
  StepExecutionResult,
  StepExecutor,
  StepValidationSummary,
  StepValidationResult,
} from '../types'

const log = createLogger('planned-executor-pass-only')

export class PassOnlyStepExecutor implements StepExecutor {
  async execute(step: PlannedTransitionStep, context: ExecutorContext): Promise<StepExecutionResult> {
    const checkedAt = new Date().toISOString()
    const validationResults: StepValidationResult[] = context.stepValidations.map((validation, index) => ({
      id: `${step.edgeId}.pass-only.${index + 1}`,
      label: validation.description,
      status: 'pass',
      reason: 'pass-only-executor',
      cacheKey: `${step.edgeId}::${validation.id}`,
      resolution: 'newly-verified',
      checkedAt,
      validationType: validation.type,
      expected: validation.expected,
      actual: 'pass-only-executor',
    }))

    const validationSummary: StepValidationSummary = {
      total: validationResults.length,
      pass: validationResults.length,
      fail: 0,
      pending: 0,
    }

    log.log('step bypassed by pass-only executor', {
      runId: context.runId,
      pathId: context.pathId,
      stepId: context.stepId,
      edgeId: step.edgeId,
      validations: validationResults.length,
    })

    return {
      result: 'pass',
      validationResults,
      validationSummary,
      narrative: {
        summary: step.label,
        taskDescription: `pass-only mode: ${step.label}`,
        validations: validationResults.map((item) => ({
          id: item.id,
          type: 'semantic-check',
          description: item.label,
          expected: item.expected,
        })),
      },
      evidence: {
        domSummary: 'pass-only-executor',
      },
    }
  }

  async onRunStop(): Promise<void> {
    return
  }

  async onRunnerReset(): Promise<void> {
    return
  }
}
