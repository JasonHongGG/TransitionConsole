import type { PathPlanner, PlannerHistoryPath } from './plannerProvider/types'
import type {
  DiagramConnector,
  DiagramLike,
  ElementExecutionStatus,
  PlannedRunPlan,
  RuntimeEdge,
} from '../types'
import { buildPlannerDiagrams } from './diagramPayload'
import { isWalked, resolveGlobalEntryStateId } from './common'
import { selectPlannedPaths } from './pathCandidates'

export const generatePlannedPaths = async (
  planner: PathPlanner,
  runId: string,
  sourceDiagrams: DiagramLike[],
  sourceConnectors: DiagramConnector[],
  allEdges: RuntimeEdge[],
  entryStateIds: string[],
  targetUrl: string,
  specRaw: string | null,
  nodeStatuses: Record<string, ElementExecutionStatus>,
  edgeStatuses: Record<string, ElementExecutionStatus>,
  previouslyPlannedPaths: PlannerHistoryPath[] = [],
): Promise<PlannedRunPlan> => {
  const normalizeId = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '')

  const plannerDiagrams = buildPlannerDiagrams(sourceDiagrams, sourceConnectors, nodeStatuses, edgeStatuses)
  const globalEntryStateId = resolveGlobalEntryStateId(sourceDiagrams, entryStateIds)

  const draftedPaths = await planner.generatePaths({
    maxPaths: 16,
    context: {
      runId,
      pathId: undefined,
      stepId: null,
      targetUrl,
      specRaw,
      diagrams: plannerDiagrams,
    },
    previouslyPlannedPaths,
  })

  const edgesById = new Map(allEdges.map((edge) => [edge.id, edge]))
  const pageEntryFromStateIds = Array.from(
    new Set(allEdges.filter((edge) => edge.fromDiagramId === 'page_entry').map((edge) => edge.fromStateId)),
  )

  const resolveEntryState = (candidate: string | null): string | null => {
    if (!candidate) return null
    if (pageEntryFromStateIds.includes(candidate)) return candidate

    const normalizedCandidate = normalizeId(candidate)
    return pageEntryFromStateIds.find((id) => normalizeId(id) === normalizedCandidate) ?? null
  }

  const inferredEntryFromDrafts = draftedPaths
    .map((draft) => draft.edgeIds?.[0])
    .map((edgeId) => (edgeId ? edgesById.get(edgeId) : undefined))
    .find((edge) => edge?.fromDiagramId === 'page_entry')?.fromStateId ?? null

  const requiredEntryStateId =
    resolveEntryState(inferredEntryFromDrafts) ??
    resolveEntryState(globalEntryStateId) ??
    resolveEntryState(entryStateIds[0] ?? null) ??
    pageEntryFromStateIds[0] ??
    null

  if (!requiredEntryStateId) {
    throw new Error('Cannot resolve required entry state for page_entry from runtime graph.')
  }

  const historicalSignatures = new Set(
    previouslyPlannedPaths
      .map((path) => (path.edgeIds ?? []).join('>'))
      .filter((signature) => signature.length > 0),
  )
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

  const paths = selectPlannedPaths(draftedPaths, {
    historicalSignatures,
    edgesById,
    requiredEntryStateId,
    walkedEdgeIds,
    walkedNodeIds,
  })

  if (paths.length === 0) {
    throw new Error('AI planner produced no valid paths. Check logs/ai-agent-responses and planner token/config.')
  }

  return { paths }
}
