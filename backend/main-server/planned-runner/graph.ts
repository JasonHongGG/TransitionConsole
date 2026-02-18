import type {
  DiagramConnector,
  DiagramLike,
  PlannedTransitionStep,
  RuntimeEdge,
} from './types'

export interface RuntimeGraph {
  edges: RuntimeEdge[]
  nodeIds: string[]
  entryStateIds: string[]
}

export const buildRuntimeGraph = (
  diagrams: DiagramLike[],
  connectorsFromApp: DiagramConnector[],
): RuntimeGraph => {
  const nodeIds = Array.from(new Set(diagrams.flatMap((diagram) => diagram.states.map((state) => state.id))))

  const transitionEdges: RuntimeEdge[] = diagrams.flatMap((diagram) =>
    diagram.transitions.map((transition) => {
      const label = transition.event ?? transition.intent?.summary ?? transition.meta?.source?.raw ?? transition.id
      return {
        id: transition.id,
        kind: 'transition',
        fromStateId: transition.from,
        toStateId: transition.to,
        fromDiagramId: diagram.id,
        toDiagramId: diagram.id,
        label,
        validations: transition.validations ?? [],
        semantic: label,
      }
    }),
  )

  const connectors = connectorsFromApp.length > 0 ? connectorsFromApp : diagrams.flatMap((diagram) => diagram.connectors)
  const connectorEdges: RuntimeEdge[] = connectors
    .filter((connector) => connector.type === 'invokes')
    .map((connector) => {
      if (!connector.from.stateId || !connector.to.stateId) return null
      return {
        id: connector.id,
        kind: 'connector',
        fromStateId: connector.from.stateId,
        toStateId: connector.to.stateId,
        fromDiagramId: connector.from.diagramId,
        toDiagramId: connector.to.diagramId,
        label: connector.meta?.reason ?? connector.id,
        validations: connector.validations ?? [],
        semantic: connector.meta?.action ?? connector.meta?.reason ?? connector.id,
      }
    })
    .filter((edge): edge is RuntimeEdge => edge !== null)

  const entryStateIds = diagrams
    .map((diagram) => diagram.meta?.entryStateId ?? null)
    .filter((value): value is string => Boolean(value))

  connectorEdges
    .flatMap((edge) => [edge.fromStateId, edge.toStateId])
    .forEach((id) => {
      if (!nodeIds.includes(id)) nodeIds.push(id)
    })

  return {
    edges: [...transitionEdges, ...connectorEdges],
    nodeIds,
    entryStateIds,
  }
}

export const toPlannedStep = (edge: RuntimeEdge, index: number): PlannedTransitionStep => ({
  id: `${edge.id}.step.${index}`,
  edgeId: edge.id,
  kind: edge.kind,
  fromStateId: edge.fromStateId,
  toStateId: edge.toStateId,
  fromDiagramId: edge.fromDiagramId,
  toDiagramId: edge.toDiagramId,
  label: edge.label,
  validations: edge.validations,
  semantic: edge.semantic,
})
