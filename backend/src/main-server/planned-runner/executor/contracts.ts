import type {
  ExecutorContext,
  StepNarrativeInstruction,
  OperatorTraceItem,
  PlannedTransitionStep,
  StepValidationSpec,
  StepExecutionResult,
  StepValidationResult,
} from '../types'

export interface StepNarrator {
  generate(step: PlannedTransitionStep, context: ExecutorContext): Promise<StepNarrativeInstruction>
  resetReplayCursor?(): Promise<void>
}

export interface BrowserOperatorRunResult {
  result: 'pass' | 'fail'
  blockedReason?: string
  failureCode?: StepExecutionResult['failureCode']
  terminationReason?: StepExecutionResult['terminationReason']
  validationResults: StepValidationResult[]
  trace: OperatorTraceItem[]
  evidence: StepExecutionResult['evidence']
}

export interface BrowserOperator {
  run(
    step: PlannedTransitionStep,
    context: ExecutorContext,
    narrative: StepNarrativeInstruction,
    validations: StepValidationSpec[],
  ): Promise<BrowserOperatorRunResult>
  cleanupPath?(runId: string, pathId: string): Promise<void>
  cleanupRun?(runId: string): Promise<void>
  resetReplayCursor?(): Promise<void>
}
