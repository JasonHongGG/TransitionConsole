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
  if (context.selectionPolicy.requirePageEntryStart && edges[0].fromDiagramId !== 'page_entry') return null
  if (context.selectionPolicy.requireRequiredEntryState && edges[0].fromStateId !== context.requiredEntryStateId) return null

  const isConnected = edges.every((edge: RuntimeEdge, index: number) => index === 0 || edges[index - 1].toStateId === edge.fromStateId)
  if (!isConnected) return null

  const newEdgeIds = edges.filter((edge: RuntimeEdge) => !context.walkedEdgeIds.has(edge.id)).map((edge: RuntimeEdge) => edge.id)
  const newNodeIds = new Set<string>()
  const touchedNodeIds = new Set<string>()
  edges.forEach((edge: RuntimeEdge) => {
    touchedNodeIds.add(edge.fromStateId)
    touchedNodeIds.add(edge.toStateId)
    if (!context.walkedNodeIds.has(edge.fromStateId)) newNodeIds.add(edge.fromStateId)
    if (!context.walkedNodeIds.has(edge.toStateId)) newNodeIds.add(edge.toStateId)
  })

  return {
    draft,
    edges,
    signature,
    pathLength: edges.length,
    newEdgeIds,
    newNodeIds: Array.from(newNodeIds),
    touchedNodeIds: Array.from(touchedNodeIds),
    newEdgeCount: newEdgeIds.length,
    newNodeCount: newNodeIds.size,
    hasNewCoverage: newEdgeIds.length > 0 || newNodeIds.size > 0,
  }
}

const prioritizeCandidates = (candidates: PlannerPathCandidate[]): PlannerPathCandidate[] => {
  const newCoverageCandidates = candidates.filter((candidate) => candidate.hasNewCoverage)
  return newCoverageCandidates.length > 0 ? newCoverageCandidates : candidates
}

type CandidateScore = {
  incrementalNewEdgeCount: number
  incrementalNewNodeCount: number
  firstFreshStepIndex: number
  touchedNodeCount: number
  historicalOverlapCount: number
  pathLength: number
}

const scoreCandidate = (
  candidate: PlannerPathCandidate,
  coveredEdgeIds: Set<string>,
  coveredNodeIds: Set<string>,
  walkedEdgeIds: Set<string>,
): CandidateScore => {
  const incrementalNewEdgeCount = candidate.newEdgeIds.filter((edgeId) => !coveredEdgeIds.has(edgeId)).length
  const incrementalNewNodeCount = candidate.newNodeIds.filter((nodeId) => !coveredNodeIds.has(nodeId)).length
  const firstFreshIndex = candidate.edges.findIndex(
    (edge) => !coveredEdgeIds.has(edge.id) || !coveredNodeIds.has(edge.fromStateId) || !coveredNodeIds.has(edge.toStateId),
  )

  return {
    incrementalNewEdgeCount,
    incrementalNewNodeCount,
    firstFreshStepIndex: firstFreshIndex === -1 ? Number.POSITIVE_INFINITY : firstFreshIndex + 1,
    touchedNodeCount: candidate.touchedNodeIds.length,
    historicalOverlapCount: candidate.edges.reduce(
      (count, edge) => count + (walkedEdgeIds.has(edge.id) ? 1 : 0),
      0,
    ),
    pathLength: candidate.pathLength,
  }
}

const compareCandidateScores = (
  left: PlannerPathCandidate,
  right: PlannerPathCandidate,
  coveredEdgeIds: Set<string>,
  coveredNodeIds: Set<string>,
  walkedEdgeIds: Set<string>,
): number => {
  const leftScore = scoreCandidate(left, coveredEdgeIds, coveredNodeIds, walkedEdgeIds)
  const rightScore = scoreCandidate(right, coveredEdgeIds, coveredNodeIds, walkedEdgeIds)

  if (leftScore.incrementalNewEdgeCount !== rightScore.incrementalNewEdgeCount) {
    return rightScore.incrementalNewEdgeCount - leftScore.incrementalNewEdgeCount
  }

  if (leftScore.incrementalNewNodeCount !== rightScore.incrementalNewNodeCount) {
    return rightScore.incrementalNewNodeCount - leftScore.incrementalNewNodeCount
  }

  if (leftScore.firstFreshStepIndex !== rightScore.firstFreshStepIndex) {
    return leftScore.firstFreshStepIndex - rightScore.firstFreshStepIndex
  }

  if (leftScore.pathLength !== rightScore.pathLength) {
    return rightScore.pathLength - leftScore.pathLength
  }

  if (leftScore.touchedNodeCount !== rightScore.touchedNodeCount) {
    return rightScore.touchedNodeCount - leftScore.touchedNodeCount
  }

  if (leftScore.historicalOverlapCount !== rightScore.historicalOverlapCount) {
    return leftScore.historicalOverlapCount - rightScore.historicalOverlapCount
  }

  return left.signature.localeCompare(right.signature)
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

  const prioritizedCandidates = context.selectionPolicy.prioritizeNewCoverage
    ? prioritizeCandidates(candidates)
    : candidates
  const seenSignatures = new Set<string>(context.historicalSignatures)
  const plannedPaths: PlannedTransitionPath[] = []
  const coveredEdgeIds = new Set<string>(context.walkedEdgeIds)
  const coveredNodeIds = new Set<string>(context.walkedNodeIds)
  const remainingCandidates = context.selectionPolicy.dedupeHistoricalSignatures
    ? prioritizedCandidates.filter((candidate) => !seenSignatures.has(candidate.signature))
    : [...prioritizedCandidates]

  while (remainingCandidates.length > 0) {
    remainingCandidates.sort((left, right) =>
      compareCandidateScores(left, right, coveredEdgeIds, coveredNodeIds, context.walkedEdgeIds),
    )

    const candidate = remainingCandidates.shift()
    if (!candidate) break

    if (context.selectionPolicy.dedupeHistoricalSignatures) {
      seenSignatures.add(candidate.signature)
    }
    plannedPaths.push(toPlannedPath(candidate, plannedPaths.length + 1))

    candidate.edges.forEach((edge) => {
      coveredEdgeIds.add(edge.id)
      coveredNodeIds.add(edge.fromStateId)
      coveredNodeIds.add(edge.toStateId)
    })
  }

  return plannedPaths
}
