import type { AgentMode, DiagramValidation, PathActorHint, StepNarrativeInstruction } from '../../planned-runner/types'
import type { PathPlannerContext, PlannedPathDraft } from '../../planned-runner/planner/types'

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

export interface PathNarratorRequestStep {
  id: string
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
  validations?: DiagramValidation[]
}

export interface PathNarratorRequestPath {
  id: string
  name: string
  semanticGoal: string
  actorHint?: PathActorHint
  steps: PathNarratorRequestStep[]
}

export interface PathNarratorRequestState {
  id: string
  walked: boolean
}

export interface PathNarratorRequestTransition {
  id: string
  from: string
  to: string
  walked: boolean
  validations?: DiagramValidation[]
  intent?: {
    summary?: string | null
  }
}

export interface PathNarratorRequestConnector {
  id: string
  type: 'contains' | 'invokes'
  from: {
    diagramId: string
    stateId: string | null
  }
  to: {
    diagramId: string
    stateId: string | null
  }
  validations?: DiagramValidation[]
  meta?: {
    reason?: string | null
    action?: string | null
  }
}

export interface PathNarratorRequestDiagram {
  id: string
  name: string
  level: string
  parentDiagramId: string | null
  roles: string[]
  variant: {
    kind: string
    baseDiagramId: string | null
    deltaDiagramIdsByRole: Record<string, string>
    appliesToRoles: string[]
  }
  states: PathNarratorRequestState[]
  transitions: PathNarratorRequestTransition[]
  connectors: PathNarratorRequestConnector[]
  meta: {
    pageName: string | null
    featureName: string | null
    entryStateId: string | null
    entryValidations: DiagramValidation[]
  }
}

export interface PathNarratorRequestContext {
  runId: string
  pathId: string
  pathExecutionId: string
  attemptId: number
  agentMode?: AgentMode
  targetUrl?: string
  specRaw: string
  diagrams: PathNarratorRequestDiagram[]
}

export interface PathNarratorGenerateRequest {
  path: PathNarratorRequestPath
  context: PathNarratorRequestContext
}

export interface PathNarratorGenerateResponse {
  narrative: StepNarrativeInstruction
}

export type PathNarratorResetResponse = ApiOkResponse
