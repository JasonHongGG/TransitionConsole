import type { ExecutorContext, PlannedTransitionStep, StepNarrativeInstruction } from '../../planned-runner/types'
import type { LoopDecision, LoopDecisionInput, LoopFunctionResponse } from '../../planned-runner/executor/contracts'
import type { PathPlannerContext, PlannedPathDraft } from '../../planned-runner/planner/plannerProvider/types'

export interface ApiOkResponse {
  ok: boolean
}

export interface PathPlannerGenerateRequest {
  context: PathPlannerContext
}

export interface PathPlannerGenerateResponse {
  paths: PlannedPathDraft[]
}

export type PathPlannerResetResponse = ApiOkResponse

export interface StepNarratorGenerateRequest {
  step: PlannedTransitionStep
  context: ExecutorContext
}

export interface StepNarratorGenerateResponse {
  narrative: StepNarrativeInstruction
}

export type OperatorLoopDecideRequest = LoopDecisionInput
export type OperatorLoopDecideResponse = LoopDecision

export interface OperatorLoopAppendFunctionResponsesRequest {
  runId: string
  pathId: string
  responses: LoopFunctionResponse[]
}

export type OperatorLoopAppendFunctionResponsesResponse = ApiOkResponse

export interface OperatorLoopCleanupRunRequest {
  runId: string
}

export type OperatorLoopCleanupRunResponse = ApiOkResponse
