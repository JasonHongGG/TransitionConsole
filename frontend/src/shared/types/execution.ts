export type TransitionResult = 'pass' | 'fail'

export type ElementExecutionStatus = 'untested' | 'running' | 'pass' | 'fail'

export type ValidationStatus = 'pass' | 'fail'

export interface StepValidationResult {
  id: string
  label: string
  status: ValidationStatus
  reason: string
}

export type PlannedStepKind = 'transition' | 'connector'

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
  nextStateId: string | null
  activeEdgeId: string | null
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

export interface PlannedRunnerStatus {
  plannedPaths: number
  completedPaths: number
  currentPathId: string | null
  currentPathName: string | null
  currentStepId: string | null
  currentStepLabel: string | null
  currentStepOrder: number | null
  currentPathStepTotal: number | null
}

export interface CoverageState {
  visitedNodes: Set<string>
  transitionResults: Record<string, TransitionResult>
  nodeStatuses?: Record<string, ElementExecutionStatus>
  edgeStatuses?: Record<string, ElementExecutionStatus>
}

export interface AgentLogEntry {
  id: string
  timestamp: string
  level: 'info' | 'success' | 'error'
  message: string
  category?: 'narrator' | 'operator' | 'tool' | 'system'
  role?: string
  diagramId?: string
  stateId?: string
  transitionId?: string
}

export interface PlannedLiveEvent {
  seq: number
  emittedAt: string
  type: string
  level: 'info' | 'success' | 'error'
  message: string
  runId?: string
  pathId?: string
  stepId?: string
  edgeId?: string
  iteration?: number
  actionCursor?: number
  meta?: Record<string, unknown>
}

export interface TestingAccount {
  role?: string
  username?: string
  password?: string
  description?: string
}

export interface UserTestingInfo {
  notes?: string
  accounts?: TestingAccount[]
}
