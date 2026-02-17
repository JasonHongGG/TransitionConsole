import { createLogger } from '../../common/logger'
import type {
  ExecutorContext,
  PlannedTransitionStep,
  StepExecutionResult,
  StepExecutor,
  StepValidationResult,
} from '../types'

const log = createLogger('planned-executor-pass-only')

export class PassOnlyStepExecutor implements StepExecutor {
  async execute(step: PlannedTransitionStep, context: ExecutorContext): Promise<StepExecutionResult> {
    const validationResults: StepValidationResult[] = context.stepValidations.map((validation, index) => ({
      id: `${step.edgeId}.pass-only.${index + 1}`,
      label: validation,
      status: 'pass',
      reason: 'pass-only-executor',
      assertionType: 'semantic-check',
      expected: validation,
      actual: 'pass-only-executor',
    }))

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
      narrative: {
        summary: step.label,
        taskDescription: `pass-only mode: ${step.label}`,
        assertions: validationResults.map((item) => ({
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
