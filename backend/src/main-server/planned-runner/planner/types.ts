import type { AgentMode, DiagramValidation, PathActorHint, RuntimeEdge } from '../types'

export interface PlannedPathDraft {
  pathId?: string
  name?: string
  semanticGoal?: string
  actorHint?: PathActorHint
  edgeIds: string[]
}

export interface PlannerHistoryPath {
  pathId?: string
  pathName?: string
  semanticGoal?: string
  edgeIds: string[]
  plannedRound?: number
}

export interface PlannerDiagramState {
  id: string
  walked: boolean
  [key: string]: unknown
}

export interface PlannerDiagramTransition {
  id: string
  from: string
  to: string
  walked: boolean
  [key: string]: unknown
}

export interface PlannerDiagramPayload {
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
  states: PlannerDiagramState[]
  transitions: PlannerDiagramTransition[]
  meta: {
    pageName: string | null
    featureName: string | null
    entryStateId: string | null
    entryValidations: DiagramValidation[]
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface PathPlannerContext {
  maxPaths: number
  agentMode?: AgentMode
  context: {
    runId?: string
    pathId?: string
    stepId?: string | null
    targetUrl: string | null
    specRaw: string | null
    diagrams: PlannerDiagramPayload[]
    availableTestingRoles: string[]
  }
  previouslyPlannedPaths: PlannerHistoryPath[]
}

export interface PathPlanner {
  generatePaths(context: PathPlannerContext): Promise<PlannedPathDraft[]>
  resetRoundCursor?(): Promise<void> | void
}

export type PlannerGeneratedPath = PlannedPathDraft

export interface PlannerPathCandidate {
  draft: PlannerGeneratedPath
  edges: RuntimeEdge[]
  signature: string
  pathLength: number
  newEdgeIds: string[]
  newNodeIds: string[]
  touchedNodeIds: string[]
  newEdgeCount: number
  newNodeCount: number
  hasNewCoverage: boolean
}

export interface PlannerPathCandidateContext {
  edgesById: Map<string, RuntimeEdge>
  requiredEntryStateId: string
  walkedEdgeIds: Set<string>
  walkedNodeIds: Set<string>
  selectionPolicy: PlannerPathSelectionPolicy
}

export interface PlannerPathSelectionContext extends PlannerPathCandidateContext {
  historicalSignatures: Set<string>
}

export interface PlannerPathSelectionPolicy {
  requirePageEntryStart: boolean
  requireRequiredEntryState: boolean
  prioritizeNewCoverage: boolean
  dedupeHistoricalSignatures: boolean
}
