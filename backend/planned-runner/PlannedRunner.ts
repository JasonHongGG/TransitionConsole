import { createLogger } from '../common/logger'
import type { PathPlanner } from './planner/plannerProvider/types'
import { StubStepExecutor } from './executor'
import { buildRuntimeGraph } from './graph'
import { generatePlannedPaths, withReindexedPaths } from './planner'
import { buildEmptySnapshot, buildRuntimeSnapshot, computeCoverageSummary } from './snapshot'
import type {
  ElementExecutionStatus,
  PlannedPathHistoryItem,
  PlannedRunnerRequest,
  PlannedStepEvent,
  PlannedStepResponse,
  RuntimeState,
  StepExecutionResult,
  StepExecutor,
} from './types'

const log = createLogger('planned-runner')

const createRunId = () => `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

const requestTargetUrl = (runtime: RuntimeState): string => runtime.targetUrl

const toHistoryItems = (plan: RuntimeState['plan'], plannedRound: number): PlannedPathHistoryItem[] =>
  plan.paths.map((path) => ({
    pathId: path.id,
    pathName: path.name,
    semanticGoal: path.semanticGoal,
    edgeIds: path.steps.map((step) => step.edgeId),
    plannedRound,
  }))

export class PlannedRunner {
  private runtime: RuntimeState | null = null
  private readonly executor: StepExecutor
  private readonly pathPlanner: PathPlanner
  private readonly resetPlannerCursorOnStart: boolean

  constructor(options: { executor?: StepExecutor; pathPlanner: PathPlanner; resetPlannerCursorOnStart?: boolean }) {
    this.executor = options.executor ?? new StubStepExecutor()
    this.pathPlanner = options.pathPlanner
    this.resetPlannerCursorOnStart = options.resetPlannerCursorOnStart ?? true
  }

  async start(request: PlannedRunnerRequest): Promise<PlannedStepResponse> {
    const runId = createRunId()

    log.log('start requested', {
      runId,
      diagrams: request.diagrams.length,
      connectors: request.connectors.length,
      targetUrl: request.targetUrl,
      hasSpec: Boolean(request.specRaw),
    })

    const graph = buildRuntimeGraph(request.diagrams, request.connectors)

    log.log('runtime graph built', {
      runId,
      edges: graph.edges.length,
      nodes: graph.nodeIds.length,
      entryStateIds: graph.entryStateIds.length,
    })

    const nodeStatuses: Record<string, ElementExecutionStatus> = {}
    graph.nodeIds.forEach((nodeId) => {
      nodeStatuses[nodeId] = 'untested'
    })

    const edgeStatuses: Record<string, ElementExecutionStatus> = {}
    graph.edges.forEach((edge) => {
      edgeStatuses[edge.id] = 'untested'
    })

    log.log('planning paths started', { runId })

    if (this.resetPlannerCursorOnStart && this.pathPlanner.resetRoundCursor) {
      await this.pathPlanner.resetRoundCursor()
      log.log('planner cursor reset before start', { runId })
    }

    if (this.executor.onRunStart) {
      await this.executor.onRunStart(runId)
    }

    const plan = await generatePlannedPaths(
      this.pathPlanner,
      request.diagrams,
      request.connectors,
      graph.edges,
      graph.entryStateIds,
      request.specRaw,
      nodeStatuses,
      edgeStatuses,
      [],
    )

    log.log('planning paths completed', {
      runId,
      plannedPaths: plan.paths.length,
    })

    this.runtime = {
      runId,
      plan,
      executedPathHistory: [],
      sourceDiagrams: request.diagrams,
      sourceConnectors: request.connectors,
      allEdges: graph.edges,
      entryStateIds: graph.entryStateIds,
      specRaw: request.specRaw,
      targetUrl: request.targetUrl,
      pathIndex: 0,
      stepIndex: 0,
      totalPlannedPaths: plan.paths.length,
      completedPathsTotal: 0,
      replanCount: 0,
      completed: false,
      currentStateId: plan.paths[0]?.steps[0]?.fromStateId ?? null,
      nodeStatuses,
      edgeStatuses,
    }

    log.log('run initialized', {
      runId,
      totalPaths: plan.paths.length,
      currentPathIndex: 0,
      currentStepIndex: 0,
    })

    return {
      ok: true,
      event: null,
      snapshot: buildRuntimeSnapshot(this.runtime),
    }
  }

  async step(): Promise<PlannedStepResponse> {
    if (!this.runtime) {
      log.log('step requested but runtime is not started')
      return {
        ok: false,
        event: null,
        snapshot: buildEmptySnapshot(),
      }
    }

    if (this.runtime.completed) {
      log.log('step requested but runtime already completed', { runId: this.runtime.runId })
      return {
        ok: true,
        event: null,
        snapshot: buildRuntimeSnapshot(this.runtime, true),
      }
    }

    const currentPath = this.runtime.plan.paths[this.runtime.pathIndex]
    if (!currentPath) {
      log.log('no current path, evaluating replan/complete', {
        runId: this.runtime.runId,
        pathIndex: this.runtime.pathIndex,
      })

      await this.maybeReplanOrComplete()

      return {
        ok: true,
        event: null,
        snapshot: this.runtime ? buildRuntimeSnapshot(this.runtime, this.runtime.completed) : buildEmptySnapshot(),
      }
    }

    const step = currentPath.steps[this.runtime.stepIndex]
    if (!step) {
      log.log('path completed, advancing to next path', {
        runId: this.runtime.runId,
        pathId: currentPath.id,
        pathName: currentPath.name,
      })
      this.runtime.pathIndex += 1
      this.runtime.stepIndex = 0
      this.runtime.completedPathsTotal += 1
      const nextPath = this.runtime.plan.paths[this.runtime.pathIndex]
      this.runtime.currentStateId = nextPath?.steps[0]?.fromStateId ?? this.runtime.currentStateId
      return {
        ok: true,
        event: null,
        snapshot: buildRuntimeSnapshot(this.runtime),
      }
    }

    this.runtime.edgeStatuses[step.edgeId] = 'running'
    this.runtime.nodeStatuses[step.fromStateId] = 'pass'

    log.log('step execution started', {
      runId: this.runtime.runId,
      pathId: currentPath.id,
      pathName: currentPath.name,
      stepId: step.id,
      edgeId: step.edgeId,
      fromStateId: step.fromStateId,
      toStateId: step.toStateId,
      label: step.label,
      kind: step.kind,
      validations: step.validations.length,
    })

    let exec: StepExecutionResult
    try {
      exec = {
        ...(await this.executor.execute(step, {
          runId: this.runtime.runId,
          pathId: currentPath.id,
          pathName: currentPath.name,
          stepId: step.id,
          semanticGoal: currentPath.semanticGoal,
          targetUrl: requestTargetUrl(this.runtime),
          stepValidations: step.validations,
        })),
      }
    } catch (error) {
      log.log('step execution threw error', {
        runId: this.runtime.runId,
        stepId: step.id,
        edgeId: step.edgeId,
        error: error instanceof Error ? error.message : 'executor error',
      })

      exec = {
        result: 'fail',
        blockedReason: error instanceof Error ? error.message : 'executor error',
        validationResults: [],
      }
    }

    const result = exec.result

    this.runtime.edgeStatuses[step.edgeId] = result
    if (result === 'pass') {
      this.runtime.nodeStatuses[step.toStateId] = 'pass'
      this.runtime.currentStateId = step.toStateId
    }

    log.log('step execution completed', {
      runId: this.runtime.runId,
      pathId: currentPath.id,
      stepId: step.id,
      edgeId: step.edgeId,
      result,
      blockedReason: exec.blockedReason ?? null,
      validationResults: exec.validationResults.length,
    })

    this.runtime.stepIndex += 1

    const event: PlannedStepEvent = {
      pathId: currentPath.id,
      pathName: currentPath.name,
      step,
      result,
      message: `${currentPath.name} :: ${step.label}`,
      blockedReason: exec.blockedReason,
      validationResults: exec.validationResults,
    }

    return {
      ok: true,
      event,
      snapshot: buildRuntimeSnapshot(this.runtime),
    }
  }

  stop(): PlannedStepResponse {
    const runId = this.runtime?.runId ?? null
    log.log('stop requested', {
      runId,
      hasRuntime: Boolean(this.runtime),
      completed: this.runtime?.completed ?? true,
    })

    if (runId && this.executor.onRunStop) {
      void this.executor.onRunStop(runId)
    }

    return {
      ok: true,
      event: null,
      snapshot: this.runtime ? buildRuntimeSnapshot(this.runtime) : buildEmptySnapshot(),
    }
  }

  reset(): PlannedStepResponse {
    const runId = this.runtime?.runId ?? null
    log.log('reset requested', {
      runId,
      hadRuntime: Boolean(this.runtime),
    })

    if (runId && this.executor.onRunStop) {
      void this.executor.onRunStop(runId)
    }

    this.runtime = null

    return {
      ok: true,
      event: null,
      snapshot: buildEmptySnapshot(),
    }
  }

  private async maybeReplanOrComplete(): Promise<void> {
    if (!this.runtime) return

    const coverage = computeCoverageSummary(this.runtime.nodeStatuses, this.runtime.edgeStatuses)

    log.log('checking replan/complete conditions', {
      runId: this.runtime.runId,
      replanCount: this.runtime.replanCount,
      uncoveredEdges: coverage.uncoveredEdgeIds.length,
      uncoveredNodes: coverage.uncoveredNodeIds.length,
    })

    if (coverage.uncoveredEdgeIds.length === 0 && coverage.uncoveredNodeIds.length === 0) {
      this.runtime.completed = true
      log.log('run completed: full coverage reached', { runId: this.runtime.runId })
      if (this.executor.onRunStop) {
        await this.executor.onRunStop(this.runtime.runId)
      }
      return
    }

    if (this.runtime.replanCount >= 6) {
      this.runtime.completed = true
      log.log('run completed: reached max replan limit', {
        runId: this.runtime.runId,
        replanCount: this.runtime.replanCount,
      })
      if (this.executor.onRunStop) {
        await this.executor.onRunStop(this.runtime.runId)
      }
      return
    }

    log.log('replan started', {
      runId: this.runtime.runId,
      remainingEdges: coverage.uncoveredEdgeIds.length,
      replanCount: this.runtime.replanCount,
    })

    const historicalBySignature = new Map<string, PlannedPathHistoryItem>()
    this.runtime.executedPathHistory.forEach((historyPath) => {
      const signature = historyPath.edgeIds.join('>')
      if (signature.length === 0) return
      historicalBySignature.set(signature, historyPath)
    })
    toHistoryItems(this.runtime.plan, this.runtime.replanCount).forEach((historyPath) => {
      const signature = historyPath.edgeIds.join('>')
      if (signature.length === 0) return
      historicalBySignature.set(signature, historyPath)
    })
    this.runtime.executedPathHistory = Array.from(historicalBySignature.values())

    const plan = await generatePlannedPaths(
      this.pathPlanner,
      this.runtime.sourceDiagrams,
      this.runtime.sourceConnectors,
      this.runtime.allEdges,
      this.runtime.entryStateIds,
      this.runtime.specRaw,
      this.runtime.nodeStatuses,
      this.runtime.edgeStatuses,
      this.runtime.executedPathHistory,
    )

    const offset = this.runtime.totalPlannedPaths + 1
    const reindexedPaths = withReindexedPaths(plan.paths, offset)

    this.runtime.plan = { paths: reindexedPaths }
    this.runtime.pathIndex = 0
    this.runtime.stepIndex = 0
    this.runtime.totalPlannedPaths += reindexedPaths.length
    this.runtime.replanCount += 1

    log.log('replan completed', {
      runId: this.runtime.runId,
      addedPaths: reindexedPaths.length,
      totalPlannedPaths: this.runtime.totalPlannedPaths,
      replanCount: this.runtime.replanCount,
    })
  }
}
