import { createLogger } from '../../common/logger'
import type {
  ExecutorContext,
  PathExecutionResult,
  PathExecutor,
  PlannedTransitionPath,
  StepValidationResult,
  StepValidationSummary,
} from '../types'

const log = createLogger('planned-executor-pass-only')

export class PassOnlyStepExecutor implements PathExecutor {
  async executePath(path: PlannedTransitionPath, context: ExecutorContext): Promise<PathExecutionResult> {
    const checkedAt = new Date().toISOString()

    const transitionResults = path.steps.map((step, index) => {
      const validationResults: StepValidationResult[] = step.validations.map((validation, validationIndex) => ({
        id: `${step.edgeId}.pass-only.${validationIndex + 1}`,
        label: validation.description,
        status: 'pass',
        reason: 'pass-only-executor',
        cacheKey: `${context.pathExecutionId}::${step.id}::${validation.id}`,
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

      return {
        step,
        result: 'pass' as const,
        validationResults,
        validationSummary,
        loopIterations: [
          {
            iteration: index + 1,
            url: context.targetUrl,
            observationSummary: 'pass-only-executor',
            action: `advance:${step.edgeId}`,
            outcome: 'success' as const,
            detail: 'pass-only executor auto-advanced the transition',
          },
        ],
        terminationReason: 'completed' as const,
        evidence: {
          domSummary: 'pass-only-executor',
        },
        trace: [
          {
            iteration: index + 1,
            url: context.targetUrl,
            observation: 'pass-only-executor',
            action: `advance:${step.edgeId}`,
            outcome: 'success' as const,
            detail: 'pass-only executor auto-advanced the transition',
          },
        ],
      }
    })

    log.log('path bypassed by pass-only executor', {
      runId: context.runId,
      pathId: context.pathId,
      pathExecutionId: context.pathExecutionId,
      transitions: transitionResults.length,
    })

    return {
      result: 'pass',
      transitionResults,
      finalStateId: path.steps[path.steps.length - 1]?.toStateId ?? path.steps[0]?.fromStateId ?? null,
    }
  }

  async onRunStop(): Promise<void> {
    return
  }

  async requestStop(): Promise<void> {
    return
  }

  async interruptRun(): Promise<void> {
    return
  }

  async onRunnerReset(): Promise<void> {
    return
  }
}
