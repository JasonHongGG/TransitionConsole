import type {
  ExecutorContext,
  PathExecutionResult,
  PlannedTransitionPath,
  StepNarrativeInstruction,
} from '../types'

export interface PathNarrator {
  generate(path: PlannedTransitionPath, context: ExecutorContext): Promise<StepNarrativeInstruction>
  resetReplayCursor?(): Promise<void>
}

export interface BrowserOperatorRunResult {
  result: PathExecutionResult['result']
  blockedReason?: PathExecutionResult['blockedReason']
  failureCode?: PathExecutionResult['failureCode']
  terminationReason?: PathExecutionResult['terminationReason']
  transitionResults: PathExecutionResult['transitionResults']
  finalStateId: PathExecutionResult['finalStateId']
}

export interface BrowserOperator {
  runPath(
    path: PlannedTransitionPath,
    context: ExecutorContext,
    narrative: StepNarrativeInstruction,
  ): Promise<BrowserOperatorRunResult>
  cleanupPath?(runId: string, pathExecutionId: string, pathId: string): Promise<void>
  cleanupRun?(runId: string): Promise<void>
  resetReplayCursor?(): Promise<void>
}
