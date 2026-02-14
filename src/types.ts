export type DiagramLevel = 'page' | 'feature'

export type StateType = 'start' | 'end' | 'normal'

export type ConnectorType = 'contains' | 'invokes'

export interface SpecSummaryRole {
  id: string
  label: string
}

export interface SpecSummary {
  productName: string
  goals: string[]
  roles: SpecSummaryRole[]
}

export interface SpecInfo {
  raw: string | null
  summary: SpecSummary
}

export interface DiagramSource {
  type: 'mermaid'
  sectionTitle: string
  order: number
}

export interface DiagramStateMeta {
  diagramId: string
  synthetic: boolean
  source: {
    scope: string
    raw: string
  }
}

export interface DiagramState {
  id: string
  label: string
  type: StateType
  groupId: string | null
  tags: string[]
  meta: DiagramStateMeta
}

export interface DiagramTransitionIntent {
  category: 'action' | 'auto'
  summary: string
}

export interface DiagramTransitionMeta {
  diagramId: string
  source: {
    raw: string
  }
}

export interface DiagramTransition {
  id: string
  from: string
  to: string
  event: string | null
  roles: string[]
  validations: string[]
  intent: DiagramTransitionIntent
  meta: DiagramTransitionMeta
}

export interface DiagramConnector {
  id: string
  type: ConnectorType
  from: {
    diagramId: string
    stateId: string | null
  }
  to: {
    diagramId: string
    stateId: string | null
  }
  meta: {
    reason: string
    orphaned?: boolean
    orphanedReason?: string
  }
}

export interface DiagramVariant {
  kind: 'standalone' | 'base' | 'delta'
  baseDiagramId: string | null
  deltaDiagramIdsByRole: Record<string, string>
  appliesToRoles: string[]
}

export interface DiagramMeta {
  pageName: string | null
  featureName: string | null
  entryStateId: string | null
  changes?: string[]
}

export interface Diagram {
  id: string
  name: string
  level: DiagramLevel
  parentDiagramId: string | null
  roles: string[]
  variant: DiagramVariant
  source: DiagramSource
  groups: unknown[]
  states: DiagramState[]
  transitions: DiagramTransition[]
  connectors: DiagramConnector[]
  meta: DiagramMeta
}

export interface HierarchyInfo {
  roots: string[]
  childrenByDiagramId: Record<string, string[]>
}

export interface GraphData {
  system: string
  version: string
  generatedAt: string
  inputs: {
    specPath: string
    transitionPath: string
  }
  spec: SpecInfo
  diagrams: Diagram[]
  hierarchy: HierarchyInfo
  meta: Record<string, unknown>
}

export interface LayoutNode {
  id: string
  label: string
  x: number
  y: number
  width: number
  height: number
  type: StateType
}

export interface LayoutEdge {
  id: string
  from: string
  to: string
  points: Array<{ x: number; y: number }>
  label: string | null
}

export interface DiagramLayout {
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  width: number
  height: number
  bounds: {
    minX: number
    maxX: number
    minY: number
    maxY: number
  }
}

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

export interface PlannedRunnerStatus {
  plannedPaths: number
  completedPaths: number
  currentPathId: string | null
  currentPathName: string | null
  currentStepId: string | null
  currentStepLabel: string | null
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
  role?: string
  diagramId?: string
  stateId?: string
  transitionId?: string
}
