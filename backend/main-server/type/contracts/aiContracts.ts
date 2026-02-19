import type { DiagramValidation, StepNarrativeInstruction } from '../../planned-runner/types'
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

export interface StepNarratorRequestStep {
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

export interface StepNarratorRequestState {
  id: string
  walked: boolean
}

export interface StepNarratorRequestTransition {
  id: string
  from: string
  to: string
  walked: boolean
  validations?: DiagramValidation[]
  intent?: {
    summary?: string | null
  }
}

export interface StepNarratorRequestConnector {
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

export interface StepNarratorRequestDiagram {
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
  states: StepNarratorRequestState[]
  transitions: StepNarratorRequestTransition[]
  connectors: StepNarratorRequestConnector[]
  meta: {
    pageName: string | null
    featureName: string | null
    entryStateId: string | null
    entryValidations: DiagramValidation[]
  }
}

export interface StepNarratorRequestContext {
  runId: string
  pathId: string
  stepId: string
  targetUrl?: string
  specRaw: string
  diagrams: StepNarratorRequestDiagram[]
}

export interface StepNarratorGenerateRequest {
  step: StepNarratorRequestStep
  context: StepNarratorRequestContext
}

export interface StepNarratorGenerateResponse {
  narrative: StepNarrativeInstruction
}

export type StepNarratorResetResponse = ApiOkResponse
