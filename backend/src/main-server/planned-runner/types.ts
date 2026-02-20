export type TransitionResult = 'pass' | 'fail'

export type ElementExecutionStatus = 'untested' | 'running' | 'pass' | 'fail'

export type PlannedStepKind = 'transition' | 'connector'

export type ValidationStatus = 'pass' | 'fail' | 'pending'

export type ValidationResolution = 'newly-verified' | 'reused-cache' | 'unverified'

export const VALIDATION_TYPES = [
  'url-equals',
  'url-includes',
  'text-visible',
  'text-not-visible',
  'element-visible',
  'element-not-visible',
  'network-success',
  'network-failed',
  'semantic-check',
] as const

export type ValidationType = (typeof VALIDATION_TYPES)[number]

export type AgentMode = 'llm' | 'mock'

export interface RunnerAgentModes {
  pathPlanner: AgentMode
  stepNarrator: AgentMode
  operatorLoop: AgentMode
}

export type OperatorActionType =
  | 'goto'
  | 'click'
  | 'type'
  | 'press'
  | 'select'
  | 'wait'
  | 'scroll'
  | 'custom'

export type ExecutionFailureCode =
  | 'narrative-planner-failed'
  | 'operator-timeout'
  | 'operator-no-progress'
  | 'operator-action-failed'
  | 'validation-failed'
  | 'unexpected-error'

export interface StepNarrativeInstruction {
  summary: string
  taskDescription: string
  validations: StepValidationSpec[]
}

export type OperatorTerminationReason = 'completed' | 'max-iterations' | 'operator-error' | 'validation-failed' | 'criteria-unmet'

export interface OperatorFunctionCallTrace {
  name: string
  args: Record<string, unknown>
  description?: string
}

export interface OperatorLoopIteration {
  iteration: number
  url: string
  observationSummary: string
  action: string
  functionCall?: OperatorFunctionCallTrace
  outcome: 'success' | 'failed' | 'skipped'
  detail?: string
}

export interface StepValidationResult {
  id: string
  label: string
  status: ValidationStatus
  reason: string
  cacheKey: string
  resolution: ValidationResolution
  checkedAt: string
  validationType?: ValidationType
  actual?: string
  expected?: string
}

export interface StepValidationSummary {
  total: number
  pass: number
  fail: number
  pending: number
}

export interface StepValidationSpec {
  id: string
  type: ValidationType
  description: string
  expected?: string
  selector?: string
  timeoutMs?: number
}

export type DiagramValidation = StepValidationSpec

export interface StepEvidence {
  beforeScreenshotPath?: string
  afterScreenshotPath?: string
  domSummary?: string
  networkSummary?: string
}

export interface OperatorTraceItem {
  iteration: number
  url: string
  observation: string
  action: string
  functionCall?: OperatorFunctionCallTrace
  outcome: 'success' | 'failed' | 'skipped'
  detail?: string
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
  validations?: DiagramValidation[]
  intent?: { summary?: string }
  meta?: { diagramId?: string; source?: { raw?: string } }
  [key: string]: unknown
}

export interface DiagramConnector {
  id: string
  type: 'contains' | 'invokes'
  from: { diagramId: string; stateId: string | null }
  to: { diagramId: string; stateId: string | null }
  validations?: DiagramValidation[]
  meta?: {
    reason?: string
    action?: string
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
    entryValidations?: DiagramValidation[]
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
  validations: StepValidationSpec[]
  semantic: string
}

export interface PlannedTransitionPath {
  id: string
  name: string
  semanticGoal: string
  steps: PlannedTransitionStep[]
}

export interface PlannedPathHistoryItem {
  pathId: string
  pathName: string
  semanticGoal: string
  edgeIds: string[]
  plannedRound: number
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
  runId: string | null
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
  agentModes: RunnerAgentModes
}

export interface PlannedStepEvent {
  pathId: string
  pathName: string
  step: PlannedTransitionStep
  result: TransitionResult
  message: string
  blockedReason?: string
  validationResults: StepValidationResult[]
  validationSummary: StepValidationSummary
}

export type PlannedLiveEventLevel = 'info' | 'success' | 'error'

export interface PlannedLiveEvent {
  seq: number
  emittedAt: string
  type: string
  level: PlannedLiveEventLevel
  message: string
  runId?: string
  pathId?: string
  stepId?: string
  edgeId?: string
  iteration?: number
  actionCursor?: number
  meta?: Record<string, unknown>
}

export type PlannedLiveEventInput = Omit<PlannedLiveEvent, 'seq' | 'emittedAt'>

export interface PlannedRunPlan {
  paths: PlannedTransitionPath[]
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

export interface PlannedRunnerRequest {
  diagrams: DiagramLike[]
  connectors: DiagramConnector[]
  specRaw: string | null
  targetUrl: string
  userTestingInfo?: UserTestingInfo
  agentModes?: Partial<RunnerAgentModes>
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
  validations: StepValidationSpec[]
  semantic: string
}

export interface RuntimeState {
  runId: string
  plan: PlannedRunPlan
  executedPathHistory: PlannedPathHistoryItem[]
  sourceDiagrams: DiagramLike[]
  sourceConnectors: DiagramConnector[]
  allEdges: RuntimeEdge[]
  entryStateIds: string[]
  specRaw: string | null
  targetUrl: string
  userTestingInfo?: UserTestingInfo
  agentModes: RunnerAgentModes
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
  runId: string
  pathId: string
  pathName: string
  stepId: string
  semanticGoal: string
  targetUrl: string
  specRaw: string | null
  userTestingInfo?: UserTestingInfo
  agentModes: RunnerAgentModes
  stepValidations: StepValidationSpec[]
  currentPathStepIndex: number
  currentPathStepTotal: number
  pathEdgeIds: string[]
  systemDiagrams: DiagramLike[]
  systemConnectors: DiagramConnector[]
}

export interface StepExecutionResult {
  result: TransitionResult
  blockedReason?: string
  validationResults: StepValidationResult[]
  validationSummary: StepValidationSummary
  narrative?: StepNarrativeInstruction
  validations?: StepValidationSpec[]
  loopIterations?: OperatorLoopIteration[]
  terminationReason?: OperatorTerminationReason
  evidence?: StepEvidence
  trace?: OperatorTraceItem[]
  failureCode?: ExecutionFailureCode
}

export interface StepExecutor {
  execute(step: PlannedTransitionStep, context: ExecutorContext): Promise<StepExecutionResult>
  onRunStart?(runId: string): Promise<void> | void
  onPathCompleted?(runId: string, pathId: string): Promise<void> | void
  onRunStop?(runId: string): Promise<void> | void
  onRunnerReset?(): Promise<void> | void
}
