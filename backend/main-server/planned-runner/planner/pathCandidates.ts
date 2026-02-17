import { toPlannedStep } from '../graph'
import type {
  PlannerGeneratedPath,
  PlannerPathCandidate,
  PlannerPathCandidateContext,
  PlannerPathSelectionContext,
} from './types'
import type { PlannedTransitionPath, RuntimeEdge } from '../types'

const buildCandidate = (
  draft: PlannerGeneratedPath,
  context: PlannerPathCandidateContext,
): PlannerPathCandidate | null => {
  const edgeIds = draft.edgeIds ?? []
  if (edgeIds.length === 0) return null

  const signature = edgeIds.join('>')
  const edges = edgeIds
    .map((edgeId: string) => context.edgesById.get(edgeId))
    .filter((edge: RuntimeEdge | undefined): edge is RuntimeEdge => Boolean(edge))

  if (edges.length !== edgeIds.length) return null
  if (edges[0].fromDiagramId !== 'page_entry') return null
  if (edges[0].fromStateId !== context.requiredEntryStateId) return null

  const isConnected = edges.every((edge: RuntimeEdge, index: number) => index === 0 || edges[index - 1].toStateId === edge.fromStateId)
  if (!isConnected) return null

  const newEdgeCount = edges.reduce((count: number, edge: RuntimeEdge) => count + (context.walkedEdgeIds.has(edge.id) ? 0 : 1), 0)
  const newNodeIds = new Set<string>()
  edges.forEach((edge: RuntimeEdge) => {
    if (!context.walkedNodeIds.has(edge.fromStateId)) newNodeIds.add(edge.fromStateId)
    if (!context.walkedNodeIds.has(edge.toStateId)) newNodeIds.add(edge.toStateId)
  })

  return {
    draft,
    edges,
    signature,
    newEdgeCount,
    newNodeCount: newNodeIds.size,
    hasNewCoverage: newEdgeCount > 0 || newNodeIds.size > 0,
  }
}

const prioritizeCandidates = (candidates: PlannerPathCandidate[]): PlannerPathCandidate[] => {
  const newCoverageCandidates = candidates.filter((candidate) => candidate.hasNewCoverage)
  return newCoverageCandidates.length > 0 ? newCoverageCandidates : candidates
}

const toPlannedPath = (candidate: PlannerPathCandidate, ordinal: number): PlannedTransitionPath => ({
  id: candidate.draft.pathId?.trim() || `path.${ordinal}`,
  name: candidate.draft.name?.trim() || `Path ${ordinal}`,
  semanticGoal: candidate.draft.semanticGoal?.trim() || candidate.edges[candidate.edges.length - 1].semantic,
  steps: candidate.edges.map((edge, index) => toPlannedStep(edge, index + 1)),
})

export const selectPlannedPaths = (
  draftedPaths: PlannerGeneratedPath[],
  context: PlannerPathSelectionContext,
): PlannedTransitionPath[] => {
  const candidates = draftedPaths
    .map((draft) => buildCandidate(draft, context))
    .filter((candidate): candidate is PlannerPathCandidate => Boolean(candidate))

  const seenSignatures = new Set<string>(context.historicalSignatures)
  const plannedPaths: PlannedTransitionPath[] = []

  prioritizeCandidates(candidates).forEach((candidate) => {
    if (seenSignatures.has(candidate.signature)) return
    seenSignatures.add(candidate.signature)
    plannedPaths.push(toPlannedPath(candidate, plannedPaths.length + 1))
  })

  return plannedPaths
}
