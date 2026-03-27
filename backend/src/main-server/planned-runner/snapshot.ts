import type {
  ElementExecutionStatus,
  PathExecutionSummary,
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
  runId: null,
  running: false,
  completed: true,
  stopRequested: false,
  batchNumber: 0,
  currentPathId: null,
  currentPathName: null,
  currentPathExecutionId: null,
  currentAttemptId: null,
  currentStepId: null,
  currentStepOrder: null,
  currentPathStepTotal: null,
  currentStateId: null,
  nextStateId: null,
  activeEdgeId: null,
  totalPaths: 0,
  completedPaths: 0,
  failedPaths: 0,
  pendingPaths: 0,
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
  agentModes: {
    pathPlanner: 'llm',
    pathNarrator: 'llm',
    operatorLoop: 'llm',
  },
  paths: [],
})

export const buildRuntimeSnapshot = (runtime: RuntimeState, forceCompleted = false): PlannedRunSnapshot => {
  const completed = forceCompleted || runtime.completed
  const coverage = computeCoverageSummary(runtime.nodeStatuses, runtime.edgeStatuses)
  const pathSummaries: PathExecutionSummary[] = [...runtime.pathSummaries]
  const pendingPaths = Math.max(0, pathSummaries.filter((path) => path.status === 'pending').length)
  const running = !completed && runtime.loopActive

  return {
    runId: runtime.runId,
    running,
    completed,
    stopRequested: runtime.stopRequested,
    batchNumber: runtime.currentBatchNumber,
    currentPathId: runtime.currentPathId,
    currentPathName: runtime.currentPathName,
    currentPathExecutionId: runtime.currentPathExecutionId,
    currentAttemptId: runtime.currentAttemptId,
    currentStepId: runtime.currentStepId,
    currentStepOrder: runtime.currentStepOrder,
    currentPathStepTotal: runtime.currentPathStepTotal,
    currentStateId: runtime.currentStateId,
    nextStateId: runtime.nextStateId,
    activeEdgeId: runtime.activeEdgeId,
    totalPaths: runtime.totalPlannedPaths,
    completedPaths: Math.min(runtime.completedPathsTotal, runtime.totalPlannedPaths),
    failedPaths: Math.min(runtime.failedPathsTotal, runtime.totalPlannedPaths),
    pendingPaths,
    nodeStatuses: runtime.nodeStatuses,
    edgeStatuses: runtime.edgeStatuses,
    coverage,
    agentModes: runtime.agentModes,
    paths: pathSummaries,
  }
}
