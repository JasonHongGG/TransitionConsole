import type { PlannedPathDraft } from './plannerProvider/types'
import type { RuntimeEdge } from '../types'

export type PlannerGeneratedPath = PlannedPathDraft

export interface PlannerPathCandidate {
  draft: PlannerGeneratedPath
  edges: RuntimeEdge[]
  signature: string
  newEdgeCount: number
  newNodeCount: number
  hasNewCoverage: boolean
}

export interface PlannerPathCandidateContext {
  edgesById: Map<string, RuntimeEdge>
  requiredEntryStateId: string
  walkedEdgeIds: Set<string>
  walkedNodeIds: Set<string>
}

export interface PlannerPathSelectionContext extends PlannerPathCandidateContext {
  historicalSignatures: Set<string>
}
