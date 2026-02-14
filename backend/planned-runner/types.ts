export type TransitionResult = 'pass' | 'fail'

export type ElementExecutionStatus = 'untested' | 'running' | 'pass' | 'fail'

export type PlannedStepKind = 'transition' | 'connector'

export type ValidationStatus = 'pass' | 'fail'

export interface StepValidationResult {
  id: string
  label: string
  status: ValidationStatus
  reason: string
}

export interface DiagramState {
  id: string
  [key: string]: unknown
}

export interface DiagramTransition {
  id: string
  from: string
  to: string
  event: string | null
  validations?: string[]
  intent?: { summary?: string }
  meta?: { diagramId?: string; source?: { raw?: string } }
  [key: string]: unknown
}

export interface DiagramConnector {
  id: string
  type: 'contains' | 'invokes'
  from: { diagramId: string; stateId: string | null }
  to: { diagramId: string; stateId: string | null }
  meta?: {
    reason?: string
    action?: string
    validations?: string[]
  }
}

export interface DiagramLike {
  id: string
  name: string
  level?: string
  parentDiagramId?: string | null
  roles?: string[]
  variant?: {
    kind?: string
    baseDiagramId?: string | null
    deltaDiagramIdsByRole?: Record<string, string>
    appliesToRoles?: string[]
  }
  states: DiagramState[]
  transitions: DiagramTransition[]
  connectors: DiagramConnector[]
  meta?: {
    pageName?: string | null
    featureName?: string | null
    entryStateId?: string | null
    entryValidations?: string[]
    [key: string]: unknown
  }
}

export interface PlannedTransitionStep {
  id: string
  edgeId: string
  kind: PlannedStepKind
  fromStateId: string
  toStateId: string
  fromDiagramId: string
  toDiagramId: string
  label: string
  validations: string[]
  semantic: string
}

export interface PlannedTransitionPath {
  id: string
  name: string
  semanticGoal: string
  steps: PlannedTransitionStep[]
}

export interface PlannedCoverageSummary {
  totalNodes: number
  totalEdges: number
  coveredNodes: number
  coveredEdges: number
  uncoveredNodeIds: string[]
  uncoveredEdgeIds: string[]
}

export interface PlannedRunSnapshot {
  running: boolean
  completed: boolean
  currentPathId: string | null
  currentStepId: string | null
  currentStepOrder: number | null
  currentPathStepTotal: number | null
  currentStateId: string | null
  totalPaths: number
  completedPaths: number
  nodeStatuses: Record<string, ElementExecutionStatus>
  edgeStatuses: Record<string, ElementExecutionStatus>
  coverage: PlannedCoverageSummary
}

export interface PlannedStepEvent {
  pathId: string
  pathName: string
  step: PlannedTransitionStep
  result: TransitionResult
  message: string
  blockedReason?: string
  validationResults: StepValidationResult[]
}

export interface PlannedRunPlan {
  paths: PlannedTransitionPath[]
}

export interface PlannedRunnerRequest {
  diagrams: DiagramLike[]
  connectors: DiagramConnector[]
  specRaw: string | null
  targetUrl: string
}

export interface PlannedStepResponse {
  ok: boolean
  event: PlannedStepEvent | null
  snapshot: PlannedRunSnapshot
}

export interface RuntimeEdge {
  id: string
  kind: PlannedStepKind
  fromStateId: string
  toStateId: string
  fromDiagramId: string
  toDiagramId: string
  label: string
  validations: string[]
  semantic: string
}

export interface RuntimeState {
  runId: string
  plan: PlannedRunPlan
  sourceDiagrams: DiagramLike[]
  sourceConnectors: DiagramConnector[]
  allEdges: RuntimeEdge[]
  entryStateIds: string[]
  specRaw: string | null
  targetUrl: string
  pathIndex: number
  stepIndex: number
  totalPlannedPaths: number
  completedPathsTotal: number
  replanCount: number
  completed: boolean
  currentStateId: string | null
  nodeStatuses: Record<string, ElementExecutionStatus>
  edgeStatuses: Record<string, ElementExecutionStatus>
}

export interface ExecutorContext {
  targetUrl: string
}

export interface StepExecutionResult {
  result: TransitionResult
  blockedReason?: string
  validationResults: StepValidationResult[]
}

export interface StepExecutor {
  execute(step: PlannedTransitionStep, context: ExecutorContext): Promise<StepExecutionResult>
}
