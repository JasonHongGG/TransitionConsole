import type { DiagramValidation } from '../../types'

export interface PlannedPathDraft {
  pathId?: string
  name?: string
  semanticGoal?: string
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
  context: {
    runId?: string
    pathId?: string
    stepId?: string | null
    targetUrl: string | null
    specRaw: string | null
    diagrams: PlannerDiagramPayload[]
  }
  previouslyPlannedPaths: PlannerHistoryPath[]
}

export interface PathPlanner {
  generatePaths(context: PathPlannerContext): Promise<PlannedPathDraft[]>
  resetRoundCursor?(): Promise<void> | void
}
