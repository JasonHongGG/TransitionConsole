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
