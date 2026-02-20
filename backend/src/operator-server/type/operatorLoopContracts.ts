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

export interface LoopDecisionInput {
  agentMode?: 'llm' | 'mock'
  context: {
    runId: string
    pathId: string
    stepId: string
    stepOrder: number
    targetUrl: string
    specRaw: string | null
    userTestingInfo?: UserTestingInfo
  }
  step: {
    edgeId: string
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
  }
  screenshotBase64: string
  narrative: {
    summary: string
    taskDescription: string
    pendingValidations: LoopValidationInput[]
    confirmedValidations: LoopConfirmedValidation[]
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
  kind: 'complete' | 'act' | 'fail'
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
  stepId: string
  stepOrder: number
  narrativeSummary: string
  runtimeState: {
    url: string
    title: string
    iteration: number
    actionCursor: number
  }
  responses: LoopFunctionResponse[]
}

export interface OperatorLoopAgent {
  decide(input: LoopDecisionInput): Promise<LoopDecision>
  appendFunctionResponses?(input: LoopAppendFunctionResponsesInput): Promise<void>
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

export type OperatorLoopCleanupRunResponse = ApiOkResponse
export type OperatorLoopResetResponse = ApiOkResponse
