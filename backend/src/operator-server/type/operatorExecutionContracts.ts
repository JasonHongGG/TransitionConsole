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

export type ValidationStatus = 'pass' | 'fail'

export type ExecutionFailureCode =
  | 'narrative-planner-failed'
  | 'operator-timeout'
  | 'operator-no-progress'
  | 'operator-action-failed'
  | 'validation-failed'
  | 'unexpected-error'

export type OperatorTerminationReason = 'completed' | 'max-iterations' | 'operator-error' | 'validation-failed' | 'criteria-unmet'

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
  validationType?: ValidationType
  actual?: string
  expected?: string
}

export interface StepNarrativeInstruction {
  summary: string
  taskDescription: string
  validations: StepValidationSpec[]
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

export interface ExecutorContext {
  runId: string
  pathId: string
  pathName: string
  stepId: string
  semanticGoal: string
  targetUrl: string
  specRaw: string | null
  userTestingInfo?: UserTestingInfo
  agentModes: {
    pathPlanner: 'llm' | 'mock'
    stepNarrator: 'llm' | 'mock'
    operatorLoop: 'llm' | 'mock'
  }
  stepValidations: StepValidationSpec[]
  currentPathStepIndex: number
  currentPathStepTotal: number
  pathEdgeIds: string[]
  systemDiagrams: unknown[]
  systemConnectors: unknown[]
}

export interface OperatorStepRunRequest {
  step: PlannedTransitionStep
  context: ExecutorContext
  narrative: StepNarrativeInstruction
  validations: StepValidationSpec[]
}

export interface OperatorStepRunResponse {
  result: 'pass' | 'fail'
  blockedReason?: string
  failureCode?: ExecutionFailureCode
  terminationReason?: OperatorTerminationReason
  validationResults: StepValidationResult[]
  trace: OperatorTraceItem[]
  evidence: StepEvidence | undefined
}

export interface OperatorCleanupRunRequest {
  runId: string
}

export interface OperatorCleanupPathRequest {
  runId: string
  pathId: string
}

export interface OperatorResetReplayResponse {
  ok: boolean
}

export type PlannedLiveEventLevel = 'info' | 'success' | 'error'

export interface PlannedLiveEventInput {
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
