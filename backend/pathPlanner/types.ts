export interface PlannedPathDraft {
  pathId?: string
  name?: string
  semanticGoal?: string
  edgeIds: string[]
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
    entryValidations: string[]
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface PathPlannerContext {
  maxPaths: number
  specRaw: string | null
  diagrams: PlannerDiagramPayload[]
}

export interface PathPlanner {
  generatePaths(context: PathPlannerContext): Promise<PlannedPathDraft[]>
  resetRoundCursor?(): Promise<void> | void
}
