import { createLogger } from '../common/logger'
import type { PathPlanner } from './planner/types'
import { StubStepExecutor } from './executor'
import { buildRuntimeGraph } from './graph'
import { generatePlannedPaths, withReindexedPaths } from './planner'
import { buildEmptySnapshot, buildRuntimeSnapshot, computeCoverageSummary } from './snapshot'
import type {
  AgentMode,
  ElementExecutionStatus,
  PlannedLiveEventInput,
  PlannedPathHistoryItem,
  PlannedRunnerRequest,
  RunnerAgentModes,
  PlannedStepEvent,
  PlannedStepResponse,
  RuntimeState,
  StepExecutionResult,
  StepExecutor,
} from './types'

const log = createLogger('planned-runner')

const createRunId = () => `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
const toElapsedSeconds = (elapsedMs: number): number => Math.max(1, Math.ceil(elapsedMs / 1000))

const isAgentMode = (value: unknown): value is AgentMode => value === 'llm' || value === 'mock'

const normalizeAgentModes = (
  defaults: RunnerAgentModes,
  overrides?: Partial<RunnerAgentModes>,
): RunnerAgentModes => ({
  pathPlanner: isAgentMode(overrides?.pathPlanner) ? overrides.pathPlanner : defaults.pathPlanner,
  stepNarrator: isAgentMode(overrides?.stepNarrator) ? overrides.stepNarrator : defaults.stepNarrator,
  operatorLoop: isAgentMode(overrides?.operatorLoop) ? overrides.operatorLoop : defaults.operatorLoop,
})

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
  private readonly publishLiveEvent?: (event: PlannedLiveEventInput) => void
  private readonly defaultAgentModes: RunnerAgentModes

  constructor(options: {
    executor?: StepExecutor
    pathPlanner: PathPlanner
    publishLiveEvent?: (event: PlannedLiveEventInput) => void
    defaultAgentModes?: RunnerAgentModes
  }) {
    this.executor = options.executor ?? new StubStepExecutor()
    this.pathPlanner = options.pathPlanner
    this.publishLiveEvent = options.publishLiveEvent
    this.defaultAgentModes = options.defaultAgentModes ?? {
      pathPlanner: 'llm',
      stepNarrator: 'llm',
      operatorLoop: 'llm',
    }
  }

  private emitLiveEvent(event: PlannedLiveEventInput): void {
    this.publishLiveEvent?.(event)
  }

  getAgentSettings(): { runId: string | null; agentModes: RunnerAgentModes } {
    if (!this.runtime) {
      return {
        runId: null,
        agentModes: this.defaultAgentModes,
      }
    }

    return {
      runId: this.runtime.runId,
      agentModes: this.runtime.agentModes,
    }
  }

  updateAgentSettings(runId: string, nextModes: Partial<RunnerAgentModes>): { runId: string; agentModes: RunnerAgentModes } {
    if (!this.runtime) {
      throw new Error('No active run to update settings')
    }

    if (this.runtime.runId !== runId) {
      throw new Error(`Run not found: ${runId}`)
    }

    this.runtime.agentModes = normalizeAgentModes(this.runtime.agentModes, nextModes)

    return {
      runId: this.runtime.runId,
      agentModes: this.runtime.agentModes,
    }
  }

  async start(request: PlannedRunnerRequest): Promise<PlannedStepResponse> {
    // 強制驗證 targetUrl 必填且非空
    if (!request.targetUrl || typeof request.targetUrl !== 'string' || request.targetUrl.trim().length === 0) {
      throw new Error('PlannedRunner: targetUrl is required and must be a non-empty string.')
    }
    const runId = createRunId()
    const initialAgentModes = normalizeAgentModes(this.defaultAgentModes, request.agentModes)

    this.emitLiveEvent({
      type: 'run.starting',
      level: 'info',
      message: 'Planned run is starting',
      runId,
    })

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

    if (this.executor.onRunStart) {
      await this.executor.onRunStart(runId)
    }

    const plannerStartedAt = Date.now()
    const plan = await generatePlannedPaths(
      this.pathPlanner,
      runId,
      request.diagrams,
      request.connectors,
      graph.edges,
      graph.entryStateIds,
      request.targetUrl,
      request.specRaw,
      nodeStatuses,
      edgeStatuses,
      [],
      initialAgentModes.pathPlanner,
    )
    const plannerElapsedMs = Date.now() - plannerStartedAt
    const plannerElapsedSeconds = toElapsedSeconds(plannerElapsedMs)

    this.emitLiveEvent({
      type: 'agent.generation.completed',
      level: 'success',
      message: `[path-planner] 生成完成，花費 ${plannerElapsedSeconds}s`,
      runId,
      meta: {
        agentTag: 'path-planner',
        elapsedMs: plannerElapsedMs,
        elapsedSeconds: plannerElapsedSeconds,
      },
    })

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
      userTestingInfo: request.userTestingInfo,
      agentModes: initialAgentModes,
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

    this.emitLiveEvent({
      type: 'run.started',
      level: 'success',
      message: 'Planned run started',
      runId,
      meta: {
        totalPaths: plan.paths.length,
      },
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
      this.emitLiveEvent({
        type: 'step.rejected',
        level: 'error',
        message: 'Step requested before run started',
      })
      return {
        ok: false,
        event: null,
        snapshot: buildEmptySnapshot(),
      }
    }

    if (this.runtime.completed) {
      log.log('step requested but runtime already completed', { runId: this.runtime.runId })
      this.emitLiveEvent({
        type: 'step.skipped',
        level: 'info',
        message: 'Step requested after run completed',
        runId: this.runtime.runId,
      })
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
      if (this.executor.onPathCompleted) {
        try {
          await this.executor.onPathCompleted(this.runtime.runId, currentPath.id)
        } catch (error) {
          log.log('path cleanup failed', {
            runId: this.runtime.runId,
            pathId: currentPath.id,
            error: error instanceof Error ? error.message : 'path cleanup failed',
          })
        }
      }
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

    this.emitLiveEvent({
      type: 'step.started',
      level: 'info',
      message: `Step started: ${step.label}`,
      runId: this.runtime.runId,
      pathId: currentPath.id,
      stepId: step.id,
      edgeId: step.edgeId,
      meta: {
        fromStateId: step.fromStateId,
        toStateId: step.toStateId,
      },
    })

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
      const stepAgentModes: RunnerAgentModes = { ...this.runtime.agentModes }
      exec = {
        ...(await this.executor.execute(step, {
          runId: this.runtime.runId,
          pathId: currentPath.id,
          pathName: currentPath.name,
          stepId: step.id,
          semanticGoal: currentPath.semanticGoal,
          targetUrl: requestTargetUrl(this.runtime),
          specRaw: this.runtime.specRaw,
          userTestingInfo: this.runtime.userTestingInfo,
          agentModes: stepAgentModes,
          stepValidations: step.validations,
          currentPathStepIndex: this.runtime.stepIndex,
          currentPathStepTotal: currentPath.steps.length,
          pathEdgeIds: currentPath.steps.map((item) => item.edgeId),
          systemDiagrams: this.runtime.sourceDiagrams,
          systemConnectors: this.runtime.sourceConnectors,
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

    this.emitLiveEvent({
      type: 'step.completed',
      level: result === 'pass' ? 'success' : 'error',
      message: `Step ${result}: ${step.label}`,
      runId: this.runtime.runId,
      pathId: currentPath.id,
      stepId: step.id,
      edgeId: step.edgeId,
      meta: {
        blockedReason: exec.blockedReason,
      },
    })

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

    if (runId) {
      this.emitLiveEvent({
        type: 'run.stopped',
        level: 'info',
        message: 'Planned run stopped',
        runId,
      })
    }

    return {
      ok: true,
      event: null,
      snapshot: this.runtime ? buildRuntimeSnapshot(this.runtime) : buildEmptySnapshot(),
    }
  }

  async reset(): Promise<PlannedStepResponse> {
    const runId = this.runtime?.runId ?? null
    log.log('reset requested', {
      runId,
      hadRuntime: Boolean(this.runtime),
    })

    if (runId && this.executor.onRunStop) {
      await this.executor.onRunStop(runId)
    }

    if (this.pathPlanner.resetRoundCursor) {
      await this.pathPlanner.resetRoundCursor()
    }

    if (this.executor.onRunnerReset) {
      await this.executor.onRunnerReset()
    }

    this.runtime = null

    if (runId) {
      this.emitLiveEvent({
        type: 'run.reset',
        level: 'info',
        message: 'Planned run reset',
        runId,
      })
    }

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
      this.emitLiveEvent({
        type: 'run.completed',
        level: 'success',
        message: 'Run completed with full coverage',
        runId: this.runtime.runId,
      })
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
      this.emitLiveEvent({
        type: 'run.completed',
        level: 'error',
        message: 'Run completed due to max replan limit',
        runId: this.runtime.runId,
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

    this.emitLiveEvent({
      type: 'replan.started',
      level: 'info',
      message: 'Replan started',
      runId: this.runtime.runId,
      meta: {
        remainingEdges: coverage.uncoveredEdgeIds.length,
      },
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

    const replanStartedAt = Date.now()
    const plan = await generatePlannedPaths(
      this.pathPlanner,
      this.runtime.runId,
      this.runtime.sourceDiagrams,
      this.runtime.sourceConnectors,
      this.runtime.allEdges,
      this.runtime.entryStateIds,
      this.runtime.targetUrl,
      this.runtime.specRaw,
      this.runtime.nodeStatuses,
      this.runtime.edgeStatuses,
      this.runtime.executedPathHistory,
      this.runtime.agentModes.pathPlanner,
    )
    const replanElapsedMs = Date.now() - replanStartedAt
    const replanElapsedSeconds = toElapsedSeconds(replanElapsedMs)

    this.emitLiveEvent({
      type: 'agent.generation.completed',
      level: 'success',
      message: `[path-planner] 生成完成，花費 ${replanElapsedSeconds}s`,
      runId: this.runtime.runId,
      meta: {
        agentTag: 'path-planner',
        elapsedMs: replanElapsedMs,
        elapsedSeconds: replanElapsedSeconds,
      },
    })

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

    this.emitLiveEvent({
      type: 'replan.completed',
      level: 'info',
      message: 'Replan completed',
      runId: this.runtime.runId,
      meta: {
        addedPaths: reindexedPaths.length,
      },
    })
  }
}
