export type ValidationType =
  | 'url-equals'
  | 'url-includes'
  | 'text-visible'
  | 'text-not-visible'
  | 'element-visible'
  | 'element-not-visible'
  | 'network-success'
  | 'network-failed'
  | 'semantic-check'

export type ValidationStatus = 'pass' | 'fail' | 'pending'

export type ValidationResolution = 'newly-verified' | 'reused-cache' | 'unverified'

export type ExecutionFailureCode =
  | 'narrative-planner-failed'
  | 'operator-timeout'
  | 'operator-no-progress'
  | 'operator-action-failed'
  | 'validation-failed'
  | 'run-interrupted'
  | 'unexpected-error'

export type OperatorTerminationReason = 'completed' | 'max-iterations' | 'operator-error' | 'validation-failed' | 'criteria-unmet' | 'stopped' | 'reset'

export interface StepValidationSpec {
  id: string
  type: ValidationType
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

export interface PathNarrativeTransitionInstruction {
  stepId: string
  edgeId: string
  summary: string
  taskDescription: string
  validations: StepValidationSpec[]
}

export interface StepNarrativeInstruction {
  summary: string
  taskDescription: string
  validations: StepValidationSpec[]
  executionStrategy?: string
  transitions?: PathNarrativeTransitionInstruction[]
}

export interface OperatorFunctionCallTrace {
  name: string
  args: Record<string, unknown>
  description?: string
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

export interface StepEvidence {
  beforeScreenshotPath?: string
  afterScreenshotPath?: string
  domSummary?: string
  networkSummary?: string
}

export interface UserTestingInfo {
  notes?: string
  accounts?: Array<{
    role?: string
    username?: string
    password?: string
    description?: string
  }>
}

export interface PlannedTransitionStep {
  id: string
  edgeId: string
  kind: 'transition' | 'connector'
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

export interface ExecutorContext {
  runId: string
  pathId: string
  pathName: string
  pathExecutionId: string
  attemptId: number
  semanticGoal: string
  targetUrl: string
  specRaw: string | null
  userTestingInfo?: UserTestingInfo
  agentModes: {
    pathPlanner: 'llm' | 'mock'
    pathNarrator: 'llm' | 'mock'
    operatorLoop: 'llm' | 'mock'
  }
  batchNumber: number
  pathIndexInBatch: number
  totalPathsInBatch: number
  currentPath: PlannedTransitionPath
  systemDiagrams: unknown[]
  systemConnectors: unknown[]
}

export interface PathTransitionResult {
  step: PlannedTransitionStep
  result: 'pass' | 'fail'
  blockedReason?: string
  failureCode?: ExecutionFailureCode
  terminationReason?: OperatorTerminationReason
  validationResults: StepValidationResult[]
  validationSummary: StepValidationSummary
  trace: OperatorTraceItem[]
  evidence?: StepEvidence
}

export interface OperatorPathRunRequest {
  path: PlannedTransitionPath
  context: ExecutorContext
  narrative: StepNarrativeInstruction
}

export interface OperatorPathRunResponse {
  result: 'pass' | 'fail'
  blockedReason?: string
  failureCode?: ExecutionFailureCode
  terminationReason?: OperatorTerminationReason
  transitionResults: PathTransitionResult[]
  finalStateId: string | null
}

export interface OperatorCleanupRunRequest {
  runId: string
}

export interface OperatorCleanupPathRequest {
  runId: string
  pathExecutionId: string
  pathId: string
}

export interface OperatorRequestStopRequest {
  runId: string
  pathExecutionId?: string
}

export interface OperatorInterruptRunRequest {
  runId: string
  reason: 'reset'
}

export interface OperatorResetReplayResponse {
  ok: boolean
}

export type PlannedLiveEventLevel = 'info' | 'success' | 'error'

export interface PlannedLiveEventInput {
  type: string
  level: PlannedLiveEventLevel
  message: string
  phase?: 'idle' | 'planning' | 'narrating' | 'operating' | 'validating' | 'paused' | 'stopping' | 'completed' | 'failed' | 'reset' | 'resetting'
  kind?: 'lifecycle' | 'progress' | 'validation' | 'issue' | 'tool'
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
  validationSummary?: {
    total: number
    pass: number
    fail: number
    pending: number
  }
  validationResults?: Array<{
    id: string
    label: string
    status: 'pass' | 'fail' | 'pending'
    reason: string
    cacheKey: string
    resolution: 'newly-verified' | 'reused-cache' | 'unverified'
    checkedAt: string
    validationType?: string
    actual?: string
    expected?: string
  }>
  meta?: Record<string, unknown>
}
