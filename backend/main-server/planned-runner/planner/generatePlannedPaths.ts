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

  const requiredEntryStateId = globalEntryStateId ?? entryStateIds[0] ?? null
  if (!requiredEntryStateId) {
    throw new Error('Cannot resolve required entry state for page_entry.')
  }

  const edgesById = new Map(allEdges.map((edge) => [edge.id, edge]))
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
