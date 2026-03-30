export type TransitionResult = 'pass' | 'fail'

export type ElementExecutionStatus = 'untested' | 'running' | 'pass' | 'fail'

export type ValidationStatus = 'pass' | 'fail' | 'pending'

export type ValidationResolution = 'newly-verified' | 'reused-cache' | 'unverified'

export type AgentMode = 'llm' | 'mock'

export interface RunnerAgentModes {
  pathPlanner: AgentMode
  pathNarrator: AgentMode
  operatorLoop: AgentMode
}

export type PlannedStepKind = 'transition' | 'connector'

export interface StepValidationSpec {
  id: string
  type: string
  description: string
  expected?: string
  selector?: string
  timeoutMs?: number
}

export interface StepValidationResult {
  id: string
  label: string
  status: ValidationStatus
  reason: string
  cacheKey: string
  resolution: ValidationResolution
  checkedAt: string
  validationType?: string
  actual?: string
  expected?: string
}

export interface StepValidationSummary {
  total: number
  pass: number
  fail: number
  pending: number
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
  validations: StepValidationSpec[]
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

export type PathExecutionStatus = 'pending' | 'running' | 'pass' | 'fail'

export interface PathExecutionSummary {
  pathId: string
  pathName: string
  semanticGoal: string
  batchNumber: number
  pathExecutionId: string | null
  attemptId: number | null
  status: PathExecutionStatus
  totalTransitions: number
  completedTransitions: number
  currentTransitionId: string | null
  currentTransitionLabel: string | null
  currentTransitionOrder: number | null
  currentStateId: string | null
  nextStateId: string | null
  activeEdgeId: string | null
  blockedReason?: string
  result?: TransitionResult
  startedAt?: string
  completedAt?: string
}

export interface PlannedRunSnapshot {
  runId: string | null
  running: boolean
  completed: boolean
  stopRequested: boolean
  batchNumber: number
  currentPathId: string | null
  currentPathName: string | null
  currentPathExecutionId: string | null
  currentAttemptId: number | null
  currentStepId: string | null
  currentStepOrder: number | null
  currentPathStepTotal: number | null
  currentStateId: string | null
  nextStateId: string | null
  activeEdgeId: string | null
  totalPaths: number
  completedPaths: number
  failedPaths: number
  pendingPaths: number
  nodeStatuses: Record<string, ElementExecutionStatus>
  edgeStatuses: Record<string, ElementExecutionStatus>
  coverage: PlannedCoverageSummary
  agentModes: RunnerAgentModes
  paths: PathExecutionSummary[]
}

export type PlannedRunnerStatus = PlannedRunSnapshot

export interface PlannedStepEvent {
  pathId: string
  pathName: string
  pathExecutionId: string
  attemptId: number
  step: PlannedTransitionStep
  result: TransitionResult
  message: string
  blockedReason?: string
  validationResults: StepValidationResult[]
  validationSummary: StepValidationSummary
}

export type ExecutionPhase =
  | 'idle'
  | 'planning'
  | 'narrating'
  | 'operating'
  | 'validating'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'reset'

export type ExecutionEventKind =
  | 'lifecycle'
  | 'progress'
  | 'validation'
  | 'issue'
  | 'tool'

export interface ExecutionEventContext {
  pathId?: string
  pathName?: string
  semanticGoal?: string
  pathOrder?: number | null
  totalPaths?: number | null
  stepId?: string
  stepLabel?: string
  stepOrder?: number | null
  totalSteps?: number | null
  currentStateId?: string | null
  nextStateId?: string | null
  activeEdgeId?: string | null
}

export interface ExecutionEventDiagnostics {
  blockedReason?: string
  failureCode?: string
  terminationReason?: string
  validationSummary?: StepValidationSummary
  validationResults?: StepValidationResult[]
  toolName?: string
  url?: string
}

export interface PlannedRunPlan {
  paths: PlannedTransitionPath[]
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
  phase?: ExecutionPhase
  kind?: ExecutionEventKind
  runId?: string
  pathId?: string
  pathName?: string
  pathExecutionId?: string
  attemptId?: number
  stepId?: string
  stepLabel?: string
  edgeId?: string
  semanticGoal?: string
  iteration?: number
  actionCursor?: number
  currentStateId?: string | null
  nextStateId?: string | null
  activeEdgeId?: string | null
  currentStepOrder?: number | null
  currentPathStepTotal?: number | null
  pathOrder?: number | null
  totalPaths?: number | null
  blockedReason?: string
  failureCode?: string
  terminationReason?: string
  validationSummary?: StepValidationSummary
  validationResults?: StepValidationResult[]
  meta?: Record<string, unknown>
}

export interface ExecutionTimelineEntry {
  id: string
  seq: number
  timestamp: string
  level: PlannedLiveEvent['level']
  phase: ExecutionPhase
  kind: ExecutionEventKind
  title: string
  detail: string
  context: ExecutionEventContext
  diagnostics: ExecutionEventDiagnostics
  rawType: string
}

export interface ExecutionIssue {
  id: string
  severity: 'error' | 'warning' | 'info'
  title: string
  detail: string
  context: ExecutionEventContext
  diagnostics: ExecutionEventDiagnostics
  timestamp: string
}

export interface ExecutionOverview {
  phase: ExecutionPhase
  phaseLabel: string
  statusLabel: string
  pathLabel: string
  stepLabel: string
  goal: string
  routeLabel: string
  latestValidationLabel: string
  latestOutcomeLabel: string
  blockedReason: string | null
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
