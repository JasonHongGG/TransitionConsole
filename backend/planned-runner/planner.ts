import type {
  PathPlanner,
  PlannerHistoryPath,
  PlannerDiagramPayload,
  PlannerDiagramState,
  PlannerDiagramTransition,
} from '../pathPlanner/types'
import { toPlannedStep } from './graph'
import type {
  DiagramConnector,
  DiagramLike,
  ElementExecutionStatus,
  PlannedRunPlan,
  PlannedTransitionPath,
  RuntimeEdge,
} from './types'

const isWalked = (status: ElementExecutionStatus | undefined): boolean =>
  status === 'running' || status === 'pass' || status === 'fail'

const buildPlannerDiagrams = (
  diagrams: DiagramLike[],
  connectorsFromApp: DiagramConnector[],
  nodeStatuses: Record<string, ElementExecutionStatus>,
  edgeStatuses: Record<string, ElementExecutionStatus>,
): PlannerDiagramPayload[] => {
  const plannerDiagrams = new Map<string, PlannerDiagramPayload>()

  diagrams.forEach((diagram) => {
    const states: PlannerDiagramState[] = (diagram.states ?? []).map((state) => ({
      ...state,
      walked: isWalked(nodeStatuses[state.id]),
    }))

    const transitions: PlannerDiagramTransition[] = (diagram.transitions ?? []).map((transition) => ({
      ...transition,
      walked: isWalked(edgeStatuses[transition.id]),
    }))

    const connectors = (diagram.connectors ?? []).map((connector) => ({
      ...connector,
      walked: connector.type === 'invokes' ? isWalked(edgeStatuses[connector.id]) : false,
    }))

    plannerDiagrams.set(diagram.id, {
      ...diagram,
      name: diagram.name,
      level: diagram.level ?? 'standalone',
      parentDiagramId: diagram.parentDiagramId ?? null,
      roles: diagram.roles ?? [],
      variant: {
        kind: diagram.variant?.kind ?? 'standalone',
        baseDiagramId: diagram.variant?.baseDiagramId ?? null,
        deltaDiagramIdsByRole: diagram.variant?.deltaDiagramIdsByRole ?? {},
        appliesToRoles: diagram.variant?.appliesToRoles ?? [],
      },
      states,
      transitions,
      connectors,
      meta: {
        pageName: (diagram.meta?.pageName as string | null | undefined) ?? diagram.name,
        featureName: (diagram.meta?.featureName as string | null | undefined) ?? null,
        entryStateId: diagram.meta?.entryStateId ?? null,
        entryValidations: diagram.meta?.entryValidations ?? [],
        ...(diagram.meta ?? {}),
      },
    })
  })

  const connectors = connectorsFromApp.length > 0 ? connectorsFromApp : diagrams.flatMap((diagram) => diagram.connectors ?? [])
  connectors
    .filter((connector) => connector.type === 'invokes' && connector.from.stateId && connector.to.stateId)
    .forEach((connector) => {
      const diagram = plannerDiagrams.get(connector.from.diagramId)
      if (!diagram) return

      const diagramWithConnectors = diagram as unknown as {
        connectors?: Array<Record<string, unknown> & { id?: string }>
      }

      const currentConnectors = Array.isArray(diagramWithConnectors.connectors)
        ? diagramWithConnectors.connectors.filter((item): item is { id?: string } => typeof item === 'object' && item !== null)
        : []

      if (!currentConnectors.some((item) => item.id === connector.id)) {
        diagramWithConnectors.connectors = [
          ...currentConnectors,
          {
            ...connector,
            walked: isWalked(edgeStatuses[connector.id]),
          },
        ]
      }

      diagram.transitions.push({
        id: connector.id,
        from: connector.from.stateId as string,
        to: connector.to.stateId as string,
        event: connector.meta?.reason ?? connector.meta?.action ?? connector.id,
        kind: 'connector-invokes',
        walked: isWalked(edgeStatuses[connector.id]),
        meta: connector.meta ?? {},
      })
    })

  return Array.from(plannerDiagrams.values())
}

const resolveGlobalEntryStateId = (sourceDiagrams: DiagramLike[], fallbackEntryStateIds: string[]): string | null => {
  const pageEntryDiagram = sourceDiagrams.find((diagram) => diagram.id === 'page_entry')
  if (pageEntryDiagram?.meta?.entryStateId) return pageEntryDiagram.meta.entryStateId

  const initState = pageEntryDiagram?.states?.find((state) => {
    const stateId = state.id.toLowerCase()
    return stateId === 'init' || stateId.endsWith('.init')
  })
  if (initState) return initState.id

  return fallbackEntryStateIds[0] ?? null
}

export const generatePlannedPaths = async (
  planner: PathPlanner,
  sourceDiagrams: DiagramLike[],
  sourceConnectors: DiagramConnector[],
  allEdges: RuntimeEdge[],
  entryStateIds: string[],
  specRaw: string | null,
  nodeStatuses: Record<string, ElementExecutionStatus>,
  edgeStatuses: Record<string, ElementExecutionStatus>,
  previouslyPlannedPaths: PlannerHistoryPath[] = [],
): Promise<PlannedRunPlan> => {
  const plannerDiagrams = buildPlannerDiagrams(sourceDiagrams, sourceConnectors, nodeStatuses, edgeStatuses)
  const globalEntryStateId = resolveGlobalEntryStateId(sourceDiagrams, entryStateIds)

  const draftedPaths = await planner.generatePaths({
    maxPaths: 16,
    specRaw,
    diagrams: plannerDiagrams,
    previouslyPlannedPaths,
  })

  const edgesById = new Map(allEdges.map((edge) => [edge.id, edge]))
  const requiredEntryStateId = globalEntryStateId ?? entryStateIds[0] ?? null
  if (!requiredEntryStateId) {
    throw new Error('Cannot resolve required entry state for page_entry.')
  }
  const paths: PlannedTransitionPath[] = []
  const historicalSignatures = new Set(
    previouslyPlannedPaths
      .map((path) => (path.edgeIds ?? []).join('>'))
      .filter((signature) => signature.length > 0),
  )
  const seenSignatures = new Set<string>(historicalSignatures)
  const walkedEdgeIds = new Set(
    Object.entries(edgeStatuses)
      .filter(([, status]) => isWalked(status))
      .map(([edgeId]) => edgeId),
  )
  const walkedNodeIds = new Set(
    Object.entries(nodeStatuses)
      .filter(([, status]) => isWalked(status))
      .map(([nodeId]) => nodeId),
  )

  type CandidatePath = {
    draft: (typeof draftedPaths)[number]
    edges: RuntimeEdge[]
    signature: string
    newEdgeCount: number
    newNodeCount: number
    hasNewCoverage: boolean
  }

  const candidates: CandidatePath[] = []

  draftedPaths.forEach((draft) => {
    const edgeIds = draft.edgeIds ?? []
    if (edgeIds.length === 0) return

    const signature = edgeIds.join('>')

    const edges = edgeIds.map((edgeId) => edgesById.get(edgeId)).filter((edge): edge is RuntimeEdge => Boolean(edge))
    if (edges.length !== edgeIds.length) return
    if (edges[0].fromDiagramId !== 'page_entry') return
    if (edges[0].fromStateId !== requiredEntryStateId) return

    const isConnected = edges.every((edge, index) => index === 0 || edges[index - 1].toStateId === edge.fromStateId)
    if (!isConnected) return

    const newEdgeCount = edges.reduce((count, edge) => count + (walkedEdgeIds.has(edge.id) ? 0 : 1), 0)
    const newNodeIds = new Set<string>()
    edges.forEach((edge) => {
      if (!walkedNodeIds.has(edge.fromStateId)) newNodeIds.add(edge.fromStateId)
      if (!walkedNodeIds.has(edge.toStateId)) newNodeIds.add(edge.toStateId)
    })

    candidates.push({
      draft,
      edges,
      signature,
      newEdgeCount,
      newNodeCount: newNodeIds.size,
      hasNewCoverage: newEdgeCount > 0 || newNodeIds.size > 0,
    })
  })

  const newCoverageCandidates = candidates.filter((candidate) => candidate.hasNewCoverage)
  const prioritizedCandidates = newCoverageCandidates.length > 0 ? newCoverageCandidates : candidates

  prioritizedCandidates
    .sort((left, right) => {
      if (right.newEdgeCount !== left.newEdgeCount) return right.newEdgeCount - left.newEdgeCount
      if (right.newNodeCount !== left.newNodeCount) return right.newNodeCount - left.newNodeCount
      return left.edges.length - right.edges.length
    })
    .forEach((candidate) => {
      if (seenSignatures.has(candidate.signature)) return

      const pathOrdinal = paths.length + 1
      seenSignatures.add(candidate.signature)
      paths.push({
        id: candidate.draft.pathId?.trim() || `path.${pathOrdinal}`,
        name: candidate.draft.name?.trim() || `Path ${pathOrdinal}`,
        semanticGoal: candidate.draft.semanticGoal?.trim() || candidate.edges[candidate.edges.length - 1].semantic,
        steps: candidate.edges.map((edge, index) => toPlannedStep(edge, index + 1)),
      })
    })

  if (paths.length === 0) {
    throw new Error('AI planner produced no valid paths. Check logs/ai-agent-responses and planner token/config.')
  }

  return { paths }
}

export const withReindexedPaths = (paths: PlannedTransitionPath[], startOrdinal: number): PlannedTransitionPath[] => {
  return paths.map((path, index) => {
    const ordinal = startOrdinal + index
    return {
      ...path,
      id: `path.${ordinal}`,
      name: `Path ${ordinal}`,
    }
  })
}
