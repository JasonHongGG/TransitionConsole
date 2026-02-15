import type {
  ElementExecutionStatus,
  PlannedCoverageSummary,
  PlannedRunSnapshot,
  RuntimeState,
} from './types'

export const computeCoverageSummary = (
  nodeStatuses: Record<string, ElementExecutionStatus>,
  edgeStatuses: Record<string, ElementExecutionStatus>,
): PlannedCoverageSummary => {
  const nodeEntries = Object.entries(nodeStatuses)
  const edgeEntries = Object.entries(edgeStatuses)

  const coveredNodes = nodeEntries.filter(([, status]) => status === 'pass' || status === 'fail').length
  const coveredEdges = edgeEntries.filter(([, status]) => status === 'pass' || status === 'fail').length

  const uncoveredNodeIds = nodeEntries
    .filter(([, status]) => status === 'untested' || status === 'running')
    .map(([id]) => id)

  const uncoveredEdgeIds = edgeEntries
    .filter(([, status]) => status === 'untested' || status === 'running')
    .map(([id]) => id)

  return {
    totalNodes: nodeEntries.length,
    totalEdges: edgeEntries.length,
    coveredNodes,
    coveredEdges,
    uncoveredNodeIds,
    uncoveredEdgeIds,
  }
}

export const buildEmptySnapshot = (): PlannedRunSnapshot => ({
  running: false,
  completed: true,
  currentPathId: null,
  currentStepId: null,
  currentStepOrder: null,
  currentPathStepTotal: null,
  currentStateId: null,
  nextStateId: null,
  activeEdgeId: null,
  totalPaths: 0,
  completedPaths: 0,
  nodeStatuses: {},
  edgeStatuses: {},
  coverage: {
    totalNodes: 0,
    totalEdges: 0,
    coveredNodes: 0,
    coveredEdges: 0,
    uncoveredNodeIds: [],
    uncoveredEdgeIds: [],
  },
})

export const buildRuntimeSnapshot = (runtime: RuntimeState, forceCompleted = false): PlannedRunSnapshot => {
  const completed = forceCompleted || runtime.completed
  const currentPath = completed ? null : runtime.plan.paths[runtime.pathIndex] ?? null
  const currentStep = currentPath?.steps[runtime.stepIndex] ?? null
  const coverage = computeCoverageSummary(runtime.nodeStatuses, runtime.edgeStatuses)
  const currentStepOrder = currentPath ? Math.min(runtime.stepIndex, currentPath.steps.length) : null
  const currentPathStepTotal = currentPath ? currentPath.steps.length : null

  let currentStateId: string | null = null
  let nextStateId: string | null = null
  let activeEdgeId: string | null = null

  if (currentPath && currentPath.steps.length > 0) {
    if (runtime.stepIndex <= 0) {
      currentStateId = null
      nextStateId = currentPath.steps[0]?.fromStateId ?? null
      activeEdgeId = null
    } else if (runtime.stepIndex < currentPath.steps.length) {
      const previousStep = currentPath.steps[runtime.stepIndex - 1]
      currentStateId = previousStep.fromStateId
      nextStateId = previousStep.toStateId
      activeEdgeId = previousStep.edgeId
    } else {
      const lastStep = currentPath.steps[currentPath.steps.length - 1]
      currentStateId = lastStep?.toStateId ?? null
      nextStateId = null
      activeEdgeId = null
    }
  }

  return {
    running: !completed,
    completed,
    currentPathId: currentPath?.id ?? null,
    currentStepId: currentStep?.id ?? null,
    currentStepOrder,
    currentPathStepTotal,
    currentStateId,
    nextStateId,
    activeEdgeId,
    totalPaths: runtime.totalPlannedPaths,
    completedPaths: Math.min(runtime.completedPathsTotal, runtime.totalPlannedPaths),
    nodeStatuses: runtime.nodeStatuses,
    edgeStatuses: runtime.edgeStatuses,
    coverage,
  }
}
