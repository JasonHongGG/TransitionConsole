import type {
  ExecutorContext,
  OperatorTraceItem,
  PlannedTransitionStep,
  StepAssertionSpec,
  StepExecutionResult,
  StepNarrativeInstruction,
  StepValidationResult,
} from '../../planned-runner/types'

export interface OperatorStepRunRequest {
  step: PlannedTransitionStep
  context: ExecutorContext
  narrative: StepNarrativeInstruction
  assertions: StepAssertionSpec[]
}

export interface OperatorStepRunResponse {
  result: 'pass' | 'fail'
  blockedReason?: string
  failureCode?: StepExecutionResult['failureCode']
  terminationReason?: StepExecutionResult['terminationReason']
  validationResults: StepValidationResult[]
  trace: OperatorTraceItem[]
  evidence: StepExecutionResult['evidence']
}

export interface OperatorCleanupRunRequest {
  runId: string
}
