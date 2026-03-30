import type { UserTestingInfo } from './operatorExecutionContracts'

export interface LoopValidationInput {
  id: string
  type: string
  description: string
  expected?: string
  selector?: string
  timeoutMs?: number
}

export interface LoopConfirmedValidation {
  id: string
  status: 'pass' | 'fail'
  reason: string
}

export interface LoopValidationUpdate {
  id: string
  status: 'pass' | 'fail'
  reason: string
  actual?: string
}

export interface LoopPathStep {
  id: string
  edgeId: string
  summary: string
  from: {
    stateId: string
    diagramId: string
  }
  to: {
    stateId: string
    diagramId: string
  }
}

export interface LoopDecisionInput {
  agentMode?: 'llm' | 'mock'
  context: {
    runId: string
    pathId: string
    pathExecutionId: string
    attemptId: number
    pathName: string
    targetUrl: string
    specRaw: string | null
    userTestingInfo?: UserTestingInfo
  }
  path: {
    id: string
    name: string
    semanticGoal: string
    totalSteps: number
    steps: LoopPathStep[]
  }
  currentTransition: {
    stepId: string
    edgeId: string
    stepOrder: number
    from: {
      stateId: string
      diagramId: string
    }
    to: {
      stateId: string
      diagramId: string
    }
    summary?: string
    semanticGoal?: string
  }
  runtimeState: {
    url: string
    title: string
    iteration: number
    actionCursor: number
    currentStepOrder: number
    totalSteps: number
    currentStateId: string
    nextStateId: string
    completedTransitions: number
    lastObservationSummary?: string
    lastObservationSource?: 'initial' | 'tool-batch'
    lastBatchToolNames?: string[]
    lastBatchBoundary?: 'batch-complete' | 'page-changed' | 'observation-required' | 'stop-requested'
  }
  screenshotBase64: string
  narrative: {
    pathSummary: string
    executionStrategy?: string
    currentTransitionSummary: string
    pendingValidations: LoopValidationInput[]
    confirmedValidations: LoopConfirmedValidation[]
    remainingTransitions: Array<{
      stepId: string
      summary: string
    }>
  }
}

export interface LoopFunctionCall {
  name: string
  args: Record<string, unknown>
  description?: string
}

export type LoopFailureCode =
  | 'narrative-planner-failed'
  | 'operator-timeout'
  | 'operator-no-progress'
  | 'operator-action-failed'
  | 'validation-failed'
  | 'unexpected-error'

export type LoopTerminationReason = 'completed' | 'max-iterations' | 'operator-error' | 'validation-failed' | 'criteria-unmet'

export interface LoopDecision {
  kind: 'complete' | 'advance' | 'act' | 'fail'
  reason: string
  progressSummary: string
  validationUpdates: LoopValidationUpdate[]
  functionCalls?: LoopFunctionCall[]
  failureCode?: LoopFailureCode
  terminationReason?: LoopTerminationReason
}

export interface LoopFunctionResponse {
  name: string
  arguments: Record<string, unknown>
  response: {
    url?: string
    status: 'success' | 'failed'
    message?: string
    result?: unknown
  }
  screenshotBase64?: string
}

export interface LoopAppendFunctionResponsesInput {
  agentMode?: 'llm' | 'mock'
  runId: string
  pathId: string
  pathExecutionId: string
  attemptId: number
  stepId: string
  stepOrder: number
  narrativeSummary: string
  runtimeState: {
    url: string
    title: string
    iteration: number
    actionCursor: number
    currentStepOrder: number
    totalSteps: number
    currentStateId: string
    nextStateId: string
    completedTransitions: number
    lastObservationSummary?: string
    lastObservationSource?: 'initial' | 'tool-batch'
    lastBatchToolNames?: string[]
    lastBatchBoundary?: 'batch-complete' | 'page-changed' | 'observation-required' | 'stop-requested'
  }
  observationSummary?: string
  observationSource?: 'initial' | 'tool-batch'
  batchBoundary?: 'batch-complete' | 'page-changed' | 'observation-required' | 'stop-requested'
  responses: LoopFunctionResponse[]
}

export interface OperatorLoopAgent {
  decide(input: LoopDecisionInput): Promise<LoopDecision>
  appendFunctionResponses?(input: LoopAppendFunctionResponsesInput): Promise<void>
  cleanupPath?(runId: string, pathExecutionId: string): Promise<void>
  cleanupRun?(runId: string): Promise<void>
  resetReplayCursor?(): Promise<void>
}

export interface ApiOkResponse {
  ok: boolean
}

export type OperatorLoopDecideRequest = LoopDecisionInput
export type OperatorLoopDecideResponse = LoopDecision

export type OperatorLoopAppendFunctionResponsesRequest = LoopAppendFunctionResponsesInput
export type OperatorLoopAppendFunctionResponsesResponse = ApiOkResponse

export interface OperatorLoopCleanupRunRequest {
  runId: string
}

export interface OperatorLoopCleanupPathRequest {
  runId: string
  pathExecutionId: string
}

export type OperatorLoopCleanupRunResponse = ApiOkResponse
export type OperatorLoopCleanupPathResponse = ApiOkResponse
export type OperatorLoopResetResponse = ApiOkResponse
