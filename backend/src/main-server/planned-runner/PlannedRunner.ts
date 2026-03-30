import { createLogger } from '../common/logger'
import type { PathPlanner } from './planner/types'
import { StubStepExecutor } from './executor'
import { buildRuntimeGraph } from './graph'
import { generatePlannedPaths, withReindexedPaths } from './planner'
import { buildEmptySnapshot, buildRuntimeSnapshot, computeCoverageSummary } from './snapshot'
import type {
  AgentMode,
  ElementExecutionStatus,
  ExecutorContext,
  PathExecutionSummary,
  PlannedLiveEventInput,
  PlannedPathHistoryItem,
  PlannedRunnerRequest,
  PlannedStepEvent,
  PlannedStepResponse,
  PlannedTransitionPath,
  RunnerAgentModes,
  RuntimeState,
  StepExecutor,
} from './types'

const log = createLogger('planned-runner')

const createRunId = () => `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
const createPathExecutionId = (pathId: string) => `px-${pathId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
const toElapsedSeconds = (elapsedMs: number): number => Math.max(1, Math.ceil(elapsedMs / 1000))

const parseOptionalPositiveInt = (raw: string | undefined): number | null => {
  if (!raw) return null
  const value = raw.trim()
  if (value.length === 0) return null
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return parsed
}

const isAgentMode = (value: unknown): value is AgentMode => value === 'llm' || value === 'mock'

const normalizeAgentModes = (
  defaults: RunnerAgentModes,
  overrides?: Partial<RunnerAgentModes>,
): RunnerAgentModes => ({
  pathPlanner: isAgentMode(overrides?.pathPlanner) ? overrides.pathPlanner : defaults.pathPlanner,
  pathNarrator: isAgentMode(overrides?.pathNarrator) ? overrides.pathNarrator : defaults.pathNarrator,
  operatorLoop: isAgentMode(overrides?.operatorLoop) ? overrides.operatorLoop : defaults.operatorLoop,
})

const requestTargetUrl = (runtime: RuntimeState): string => runtime.targetUrl

const toHistoryItems = (paths: PlannedTransitionPath[], plannedRound: number): PlannedPathHistoryItem[] =>
  paths.map((path) => ({
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
  private readonly maxCompletedPaths: number | null
  private activeLoop: Promise<void> | null = null

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
      pathNarrator: 'llm',
      operatorLoop: 'llm',
    }
    this.maxCompletedPaths = parseOptionalPositiveInt(process.env.PLANNED_RUNNER_AUTO_MAX_PATHS)
  }

  private emitLiveEvent(event: PlannedLiveEventInput): void {
    this.publishLiveEvent?.(event)
  }

  private createPathSummaries(paths: PlannedTransitionPath[], batchNumber: number): PathExecutionSummary[] {
    return paths.map((path) => ({
      pathId: path.id,
      pathName: path.name,
      semanticGoal: path.semanticGoal,
      batchNumber,
      pathExecutionId: null,
      attemptId: null,
      status: 'pending',
      totalTransitions: path.steps.length,
      completedTransitions: 0,
      currentTransitionId: null,
      currentTransitionLabel: null,
      currentTransitionOrder: null,
      currentStateId: path.steps[0]?.fromStateId ?? null,
      nextStateId: path.steps[0]?.toStateId ?? null,
      activeEdgeId: path.steps[0]?.edgeId ?? null,
    }))
  }

  private upsertPathSummaries(nextSummaries: PathExecutionSummary[]): void {
    if (!this.runtime) return
    this.runtime.pathSummaries = [...this.runtime.pathSummaries, ...nextSummaries]
  }

  private updatePathSummary(pathId: string, batchNumber: number, updater: (summary: PathExecutionSummary) => PathExecutionSummary): void {
    if (!this.runtime) return
    this.runtime.pathSummaries = this.runtime.pathSummaries.map((summary) => {
      if (summary.pathId !== pathId || summary.batchNumber !== batchNumber) {
        return summary
      }
      return updater(summary)
    })
  }

  private setActiveCursor(path: PlannedTransitionPath, pathExecutionId: string, attemptId: number, currentTransitionIndex: number | null): void {
    if (!this.runtime) return
    const step = currentTransitionIndex === null ? null : path.steps[currentTransitionIndex] ?? null
    this.runtime.currentPathId = path.id
    this.runtime.currentPathName = path.name
    this.runtime.currentPathExecutionId = pathExecutionId
    this.runtime.currentAttemptId = attemptId
    this.runtime.currentStepId = step?.id ?? null
    this.runtime.currentStepOrder = step ? currentTransitionIndex! + 1 : null
    this.runtime.currentPathStepTotal = path.steps.length
    this.runtime.currentStateId = step?.fromStateId ?? path.steps[path.steps.length - 1]?.toStateId ?? null
    this.runtime.nextStateId = step?.toStateId ?? null
    this.runtime.activeEdgeId = step?.edgeId ?? null
  }

  private clearActiveCursor(): void {
    if (!this.runtime) return
    this.runtime.currentPathId = null
    this.runtime.currentPathName = null
    this.runtime.currentPathExecutionId = null
    this.runtime.currentAttemptId = null
    this.runtime.currentStepId = null
    this.runtime.currentStepOrder = null
    this.runtime.currentPathStepTotal = null
    this.runtime.activeEdgeId = null
    this.runtime.nextStateId = null
  }

  private async maybeStopAfterMaxPaths(): Promise<boolean> {
    if (!this.runtime) return false
    if (this.runtime.completed) return true
    if (!this.maxCompletedPaths) return false

    const finishedPaths = this.runtime.completedPathsTotal + this.runtime.failedPathsTotal
    if (finishedPaths < this.maxCompletedPaths) return false

    await this.completeRun('success', `Run completed: reached max paths limit (${this.maxCompletedPaths})`)
    return true
  }

  private async completeRun(level: 'success' | 'error' | 'info', message: string): Promise<void> {
    if (!this.runtime || this.runtime.completed) return
    this.runtime.completed = true
    this.runtime.loopActive = false
    this.runtime.stopRequested = false
    this.clearActiveCursor()
    this.emitLiveEvent({
      type: 'run.completed',
      level,
      message,
      phase: level === 'error' ? 'failed' : 'completed',
      kind: level === 'error' ? 'issue' : 'lifecycle',
      runId: this.runtime.runId,
      totalPaths: this.runtime.totalPlannedPaths,
    })
    if (this.executor.onRunStop) {
      await this.executor.onRunStop(this.runtime.runId)
    }
  }

  private async finalizeStop(): Promise<void> {
    if (!this.runtime) return
    this.runtime.loopActive = false
    this.runtime.stopRequested = false
    this.clearActiveCursor()
    this.emitLiveEvent({
      type: 'run.stopped',
      level: 'info',
      message: 'Planned run stopped',
      phase: 'paused',
      kind: 'lifecycle',
      runId: this.runtime.runId,
    })
    if (this.executor.onRunStop) {
      await this.executor.onRunStop(this.runtime.runId)
    }
  }

  private ensureLoop(): void {
    if (this.activeLoop) return
    if (this.runtime) {
      this.runtime.loopActive = true
    }
    this.activeLoop = this.runLoop().finally(() => {
      if (this.runtime && !this.runtime.completed && !this.runtime.stopRequested) {
        this.runtime.loopActive = false
      }
      this.activeLoop = null
    })
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

  getStatus(): PlannedStepResponse {
    return {
      ok: true,
      event: null,
      snapshot: this.runtime ? buildRuntimeSnapshot(this.runtime, this.runtime.completed) : buildEmptySnapshot(),
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
    if (!request.targetUrl || typeof request.targetUrl !== 'string' || request.targetUrl.trim().length === 0) {
      throw new Error('PlannedRunner: targetUrl is required and must be a non-empty string.')
    }
    if (this.runtime && !this.runtime.completed) {
      if (this.runtime.loopActive) {
        throw new Error(`Run already active: ${this.runtime.runId}`)
      }

      this.runtime.stopRequested = false
      this.runtime.resetRequested = false
      this.runtime.targetUrl = request.targetUrl
      this.runtime.userTestingInfo = request.userTestingInfo
      this.runtime.agentModes = normalizeAgentModes(this.runtime.agentModes, request.agentModes)

      this.emitLiveEvent({
        type: 'run.resumed',
        level: 'info',
        message: 'Planned run resumed',
        phase: this.runtime.currentPathId ? 'operating' : 'planning',
        kind: 'lifecycle',
        runId: this.runtime.runId,
        pathId: this.runtime.currentPathId ?? undefined,
        pathName: this.runtime.currentPathName ?? undefined,
        stepId: this.runtime.currentStepId ?? undefined,
        currentStateId: this.runtime.currentStateId,
        nextStateId: this.runtime.nextStateId,
        activeEdgeId: this.runtime.activeEdgeId,
        currentStepOrder: this.runtime.currentStepOrder,
        currentPathStepTotal: this.runtime.currentPathStepTotal,
        totalPaths: this.runtime.totalPlannedPaths,
      })

      this.ensureLoop()

      return {
        ok: true,
        event: null,
        snapshot: buildRuntimeSnapshot(this.runtime),
      }
    }

    const runId = createRunId()
    const initialAgentModes = normalizeAgentModes(this.defaultAgentModes, request.agentModes)

    this.emitLiveEvent({
      type: 'run.starting',
      level: 'info',
      message: 'Planned run is starting',
      phase: 'planning',
      kind: 'lifecycle',
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

    const nodeStatuses: Record<string, ElementExecutionStatus> = {}
    graph.nodeIds.forEach((nodeId) => {
      nodeStatuses[nodeId] = 'untested'
    })

    const edgeStatuses: Record<string, ElementExecutionStatus> = {}
    graph.edges.forEach((edge) => {
      edgeStatuses[edge.id] = 'untested'
    })

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
      phase: 'planning',
      kind: 'progress',
      runId,
      meta: {
        agentTag: 'path-planner',
        elapsedMs: plannerElapsedMs,
        elapsedSeconds: plannerElapsedSeconds,
      },
    })

    const currentBatchNumber = 1
    const initialSummaries = this.createPathSummaries(plan.paths, currentBatchNumber)

    this.runtime = {
      runId,
      sourceDiagrams: request.diagrams,
      sourceConnectors: request.connectors,
      allEdges: graph.edges,
      entryStateIds: graph.entryStateIds,
      specRaw: request.specRaw,
      targetUrl: request.targetUrl,
      userTestingInfo: request.userTestingInfo,
      agentModes: initialAgentModes,
      currentBatchPaths: plan.paths,
      currentBatchNumber,
      currentBatchCursor: 0,
      executedPathHistory: [],
      pathSummaries: initialSummaries,
      totalPlannedPaths: plan.paths.length,
      completedPathsTotal: 0,
      failedPathsTotal: 0,
      replanCount: 0,
      completed: false,
      loopActive: false,
      stopRequested: false,
      resetRequested: false,
      currentPathId: null,
      currentPathName: null,
      currentPathExecutionId: null,
      currentAttemptId: null,
      currentStepId: null,
      currentStepOrder: null,
      currentPathStepTotal: null,
      currentStateId: plan.paths[0]?.steps[0]?.fromStateId ?? null,
      nextStateId: plan.paths[0]?.steps[0]?.toStateId ?? null,
      activeEdgeId: null,
      nodeStatuses,
      edgeStatuses,
    }

    this.emitLiveEvent({
      type: 'run.started',
      level: 'success',
      message: 'Planned run started',
      phase: 'planning',
      kind: 'lifecycle',
      runId,
      totalPaths: plan.paths.length,
      pathOrder: 0,
    })
    this.emitLiveEvent({
      type: 'batch.started',
      level: 'info',
      message: 'Path batch started',
      phase: 'planning',
      kind: 'progress',
      runId,
      totalPaths: plan.paths.length,
      meta: {
        batchNumber: currentBatchNumber,
      },
    })

    this.ensureLoop()

    return {
      ok: true,
      event: null,
      snapshot: buildRuntimeSnapshot(this.runtime),
    }
  }

  private async runLoop(): Promise<void> {
    while (this.runtime && !this.runtime.completed) {
      if (this.runtime.stopRequested && this.runtime.currentPathExecutionId === null) {
        await this.finalizeStop()
        return
      }

      if (await this.maybeStopAfterMaxPaths()) {
        return
      }

      const currentPath = this.runtime.currentBatchPaths[this.runtime.currentBatchCursor]
      if (!currentPath) {
        await this.maybeReplanOrComplete()
        if (this.runtime?.completed) {
          return
        }
        continue
      }

      await this.executeCurrentPath(currentPath, this.runtime.currentBatchCursor)
    }
  }

  private async executeCurrentPath(path: PlannedTransitionPath, pathIndexInBatch: number): Promise<void> {
    const runtime = this.runtime
    if (!runtime) return

    const attemptId = 1
    const pathExecutionId = createPathExecutionId(path.id)
    const startedAt = new Date().toISOString()

    this.setActiveCursor(path, pathExecutionId, attemptId, 0)
    this.updatePathSummary(path.id, runtime.currentBatchNumber, (summary) => ({
      ...summary,
      pathExecutionId,
      attemptId,
      status: 'running',
      startedAt,
      currentTransitionId: path.steps[0]?.id ?? null,
      currentTransitionLabel: path.steps[0]?.label ?? null,
      currentTransitionOrder: path.steps.length > 0 ? 1 : null,
      currentStateId: path.steps[0]?.fromStateId ?? null,
      nextStateId: path.steps[0]?.toStateId ?? null,
      activeEdgeId: path.steps[0]?.edgeId ?? null,
      blockedReason: undefined,
    }))

    this.emitLiveEvent({
      type: 'path.started',
      level: 'info',
      message: `Path started: ${path.name}`,
      phase: 'operating',
      kind: 'progress',
      runId: runtime.runId,
      pathId: path.id,
      pathName: path.name,
      pathExecutionId,
      attemptId,
      stepId: path.steps[0]?.id,
      stepLabel: path.steps[0]?.label,
      currentStateId: path.steps[0]?.fromStateId ?? null,
      nextStateId: path.steps[0]?.toStateId ?? null,
      activeEdgeId: path.steps[0]?.edgeId ?? null,
      currentStepOrder: path.steps.length > 0 ? 1 : null,
      currentPathStepTotal: path.steps.length,
      pathOrder: pathIndexInBatch + 1,
      totalPaths: runtime.currentBatchPaths.length,
      semanticGoal: path.semanticGoal,
      meta: {
        batchNumber: runtime.currentBatchNumber,
      },
    })

    const context: ExecutorContext = {
      runId: runtime.runId,
      pathId: path.id,
      pathName: path.name,
      pathExecutionId,
      attemptId,
      semanticGoal: path.semanticGoal,
      targetUrl: requestTargetUrl(runtime),
      specRaw: runtime.specRaw,
      userTestingInfo: runtime.userTestingInfo,
      agentModes: { ...runtime.agentModes },
      batchNumber: runtime.currentBatchNumber,
      pathIndexInBatch,
      totalPathsInBatch: runtime.currentBatchPaths.length,
      currentPath: path,
      systemDiagrams: runtime.sourceDiagrams,
      systemConnectors: runtime.sourceConnectors,
    }

    const result = await this.executor.executePath(path, context)
    if (!this.runtime || this.runtime !== runtime || runtime.resetRequested) {
      return
    }

    const completedAt = new Date().toISOString()
    let latestEvent: PlannedStepEvent | null = null

    result.transitionResults.forEach((transitionResult, index) => {
      const step = transitionResult.step
      runtime.nodeStatuses[step.fromStateId] = 'pass'
      runtime.edgeStatuses[step.edgeId] = transitionResult.result
      runtime.currentStateId = step.fromStateId
      runtime.nextStateId = step.toStateId
      runtime.activeEdgeId = step.edgeId
      runtime.currentStepId = step.id
      runtime.currentStepOrder = index + 1
      runtime.currentPathStepTotal = path.steps.length
      if (transitionResult.result === 'pass') {
        runtime.nodeStatuses[step.toStateId] = 'pass'
      }

      latestEvent = {
        pathId: path.id,
        pathName: path.name,
        pathExecutionId,
        attemptId,
        step,
        result: transitionResult.result,
        message: `${path.name} :: ${step.label}`,
        blockedReason: transitionResult.blockedReason,
        validationResults: transitionResult.validationResults,
        validationSummary: transitionResult.validationSummary,
      }
    })

    const completedTransitions = result.transitionResults.length
    const finalTransition = result.transitionResults[result.transitionResults.length - 1]
    if (result.terminationReason === 'stopped') {
      this.updatePathSummary(path.id, runtime.currentBatchNumber, (summary) => ({
        ...summary,
        pathExecutionId: null,
        attemptId: null,
        status: 'paused',
        blockedReason: result.blockedReason,
        completedTransitions,
        currentTransitionId: finalTransition?.step.id ?? summary.currentTransitionId,
        currentTransitionLabel: finalTransition?.step.label ?? summary.currentTransitionLabel,
        currentTransitionOrder: completedTransitions > 0 ? completedTransitions : summary.currentTransitionOrder,
        currentStateId: result.finalStateId,
        nextStateId: path.steps[0]?.toStateId ?? null,
        activeEdgeId: finalTransition?.step.edgeId ?? summary.activeEdgeId,
        completedAt,
      }))

      this.emitLiveEvent({
        type: 'path.paused',
        level: 'info',
        message: result.blockedReason ?? `Path paused: ${path.name}`,
        phase: 'paused',
        kind: 'lifecycle',
        runId: runtime.runId,
        pathId: path.id,
        pathName: path.name,
        pathExecutionId,
        attemptId,
        currentStateId: result.finalStateId,
        stepId: finalTransition?.step.id,
        stepLabel: finalTransition?.step.label,
        activeEdgeId: finalTransition?.step.edgeId ?? null,
        currentStepOrder: completedTransitions,
        currentPathStepTotal: path.steps.length,
        pathOrder: pathIndexInBatch + 1,
        totalPaths: runtime.currentBatchPaths.length,
        semanticGoal: path.semanticGoal,
        blockedReason: result.blockedReason,
        terminationReason: result.terminationReason,
      })

      if (this.executor.cleanupPath) {
        await this.executor.cleanupPath(runtime.runId, pathExecutionId, path.id)
      }

      this.clearActiveCursor()
      runtime.currentStateId = result.finalStateId
      runtime.nextStateId = null
      runtime.activeEdgeId = null
      return
    }

    if (result.terminationReason === 'reset') {
      this.clearActiveCursor()
      return
    }

    this.updatePathSummary(path.id, runtime.currentBatchNumber, (summary) => ({
      ...summary,
      pathExecutionId,
      attemptId,
      status: result.result,
      result: result.result,
      blockedReason: result.blockedReason,
      completedTransitions,
      currentTransitionId: finalTransition?.step.id ?? null,
      currentTransitionLabel: finalTransition?.step.label ?? null,
      currentTransitionOrder: completedTransitions > 0 ? completedTransitions : null,
      currentStateId: result.finalStateId,
      nextStateId: null,
      activeEdgeId: finalTransition?.step.edgeId ?? null,
      completedAt,
    }))

    if (result.result === 'pass') {
      runtime.completedPathsTotal += 1
      this.emitLiveEvent({
        type: 'path.completed',
        level: 'success',
        message: `Path completed: ${path.name}`,
        phase: 'completed',
        kind: 'progress',
        runId: runtime.runId,
        pathId: path.id,
        pathName: path.name,
        pathExecutionId,
        attemptId,
        currentStateId: result.finalStateId,
        stepId: finalTransition?.step.id,
        stepLabel: finalTransition?.step.label,
        activeEdgeId: finalTransition?.step.edgeId ?? null,
        currentStepOrder: completedTransitions,
        currentPathStepTotal: path.steps.length,
        pathOrder: pathIndexInBatch + 1,
        totalPaths: runtime.currentBatchPaths.length,
        semanticGoal: path.semanticGoal,
        validationSummary: finalTransition?.validationSummary,
        validationResults: finalTransition?.validationResults,
      })
    } else {
      runtime.failedPathsTotal += 1
      this.emitLiveEvent({
        type: 'path.failed',
        level: 'error',
        message: result.blockedReason ?? `Path failed: ${path.name}`,
        phase: 'failed',
        kind: 'issue',
        runId: runtime.runId,
        pathId: path.id,
        pathName: path.name,
        pathExecutionId,
        attemptId,
        currentStateId: result.finalStateId,
        stepId: finalTransition?.step.id,
        stepLabel: finalTransition?.step.label,
        activeEdgeId: finalTransition?.step.edgeId ?? null,
        currentStepOrder: completedTransitions,
        currentPathStepTotal: path.steps.length,
        pathOrder: pathIndexInBatch + 1,
        totalPaths: runtime.currentBatchPaths.length,
        semanticGoal: path.semanticGoal,
        blockedReason: result.blockedReason,
        failureCode: result.failureCode,
        terminationReason: result.terminationReason,
        validationSummary: finalTransition?.validationSummary,
        validationResults: finalTransition?.validationResults,
        meta: {
          failureCode: result.failureCode,
          terminationReason: result.terminationReason,
        },
      })
    }

    runtime.executedPathHistory.push({
      pathId: path.id,
      pathName: path.name,
      semanticGoal: path.semanticGoal,
      edgeIds: path.steps.map((step) => step.edgeId),
      plannedRound: runtime.replanCount,
    })

    if (this.executor.cleanupPath) {
      try {
        await this.executor.cleanupPath(runtime.runId, pathExecutionId, path.id)
      } catch (error) {
        log.log('path cleanup failed', {
          runId: runtime.runId,
          pathId: path.id,
          pathExecutionId,
          error: error instanceof Error ? error.message : 'path cleanup failed',
        })
      }
    }

    runtime.currentBatchCursor += 1
    this.clearActiveCursor()
    runtime.currentStateId = result.finalStateId

    if (latestEvent) {
      this.emitLiveEvent({
        type: 'transition.completed',
        level: latestEvent.result === 'pass' ? 'success' : 'error',
        message: latestEvent.message,
        phase: latestEvent.result === 'pass' ? 'validating' : 'failed',
        kind: latestEvent.result === 'pass' ? 'validation' : 'issue',
        runId: runtime.runId,
        pathId: latestEvent.pathId,
        pathName: latestEvent.pathName,
        pathExecutionId: latestEvent.pathExecutionId,
        attemptId: latestEvent.attemptId,
        stepId: latestEvent.step.id,
        stepLabel: latestEvent.step.label,
        edgeId: latestEvent.step.edgeId,
        semanticGoal: path.semanticGoal,
        currentStateId: latestEvent.step.fromStateId,
        nextStateId: latestEvent.step.toStateId,
        activeEdgeId: latestEvent.step.edgeId,
        currentStepOrder: completedTransitions,
        currentPathStepTotal: path.steps.length,
        blockedReason: latestEvent.blockedReason,
        validationSummary: latestEvent.validationSummary,
        validationResults: latestEvent.validationResults,
      })
    }
  }

  async stop(): Promise<PlannedStepResponse> {
    if (!this.runtime) {
      return {
        ok: true,
        event: null,
        snapshot: buildEmptySnapshot(),
      }
    }

    this.runtime.stopRequested = true
    if (this.executor.requestStop) {
      await this.executor.requestStop(this.runtime.runId, this.runtime.currentPathExecutionId ?? undefined)
    }
    this.emitLiveEvent({
      type: 'run.stop-requested',
      level: 'info',
      message: 'Stop requested. Will pause at the next tool boundary.',
      phase: this.runtime.currentPathExecutionId ? 'stopping' : 'paused',
      kind: 'lifecycle',
      runId: this.runtime.runId,
      pathId: this.runtime.currentPathId ?? undefined,
      pathName: this.runtime.currentPathName ?? undefined,
      stepId: this.runtime.currentStepId ?? undefined,
      currentStateId: this.runtime.currentStateId,
      nextStateId: this.runtime.nextStateId,
      activeEdgeId: this.runtime.activeEdgeId,
      currentStepOrder: this.runtime.currentStepOrder,
      currentPathStepTotal: this.runtime.currentPathStepTotal,
      totalPaths: this.runtime.totalPlannedPaths,
    })

    if (!this.activeLoop && this.runtime.currentPathExecutionId === null) {
      await this.finalizeStop()
    } else if (!this.activeLoop) {
      this.ensureLoop()
    }

    return {
      ok: true,
      event: null,
      snapshot: buildRuntimeSnapshot(this.runtime),
    }
  }

  async reset(): Promise<PlannedStepResponse> {
    const runtime = this.runtime
    const runId = runtime?.runId ?? null

    if (runtime) {
      runtime.resetRequested = true
      runtime.completed = true
      runtime.loopActive = false
      runtime.stopRequested = false
      this.emitLiveEvent({
        type: 'run.reset-requested',
        level: 'info',
        message: 'Force reset requested',
        phase: 'resetting',
        kind: 'lifecycle',
        runId,
        pathId: runtime.currentPathId ?? undefined,
        pathName: runtime.currentPathName ?? undefined,
        stepId: runtime.currentStepId ?? undefined,
      })

      if (runtime.currentPathExecutionId && this.executor.interruptRun) {
        await this.executor.interruptRun(runId!, 'reset')
      }
    }

    if (this.activeLoop) {
      await this.activeLoop.catch(() => undefined)
    }

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
        phase: 'reset',
        kind: 'lifecycle',
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
    const currentBatchPaths = this.runtime.currentBatchPaths
    const currentRunId = this.runtime.runId

    if (coverage.uncoveredEdgeIds.length === 0 && coverage.uncoveredNodeIds.length === 0) {
      await this.completeRun('success', 'Run completed with full coverage')
      return
    }

    if (this.runtime.stopRequested) {
      await this.finalizeStop()
      return
    }

    if (this.runtime.replanCount >= 6) {
      await this.completeRun('error', 'Run completed due to max replan limit')
      return
    }

    const historicalBySignature = new Map<string, PlannedPathHistoryItem>()
    this.runtime.executedPathHistory.forEach((historyPath) => {
      const signature = historyPath.edgeIds.join('>')
      if (signature.length > 0) historicalBySignature.set(signature, historyPath)
    })
    toHistoryItems(currentBatchPaths, this.runtime.replanCount).forEach((historyPath) => {
      const signature = historyPath.edgeIds.join('>')
      if (signature.length > 0) historicalBySignature.set(signature, historyPath)
    })
    this.runtime.executedPathHistory = Array.from(historicalBySignature.values())

    this.emitLiveEvent({
      type: 'replan.started',
      level: 'info',
      message: 'Replan started',
      phase: 'planning',
      kind: 'progress',
      runId: currentRunId,
      meta: {
        batchNumber: this.runtime.currentBatchNumber,
        remainingEdges: coverage.uncoveredEdgeIds.length,
      },
    })

    const replanStartedAt = Date.now()
    let plan: Awaited<ReturnType<typeof generatePlannedPaths>>
    try {
      plan = await generatePlannedPaths(
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
    } catch (error) {
      const message = error instanceof Error ? error.message : 'replan failed'
      if (message.includes('AI planner produced no valid paths')) {
        await this.completeRun('info', 'Run completed: planner returned no additional valid paths')
        return
      }
      throw error
    }
    const replanElapsedMs = Date.now() - replanStartedAt
    const replanElapsedSeconds = toElapsedSeconds(replanElapsedMs)

    this.emitLiveEvent({
      type: 'agent.generation.completed',
      level: 'success',
      message: `[path-planner] 生成完成，花費 ${replanElapsedSeconds}s`,
      phase: 'planning',
      kind: 'progress',
      runId: currentRunId,
      meta: {
        agentTag: 'path-planner',
        elapsedMs: replanElapsedMs,
        elapsedSeconds: replanElapsedSeconds,
      },
    })

    const offset = this.runtime.totalPlannedPaths + 1
    const reindexedPaths = withReindexedPaths(plan.paths, offset)
    this.runtime.currentBatchNumber += 1
    this.runtime.currentBatchPaths = reindexedPaths
    this.runtime.currentBatchCursor = 0
    this.runtime.totalPlannedPaths += reindexedPaths.length
    this.runtime.replanCount += 1
    this.upsertPathSummaries(this.createPathSummaries(reindexedPaths, this.runtime.currentBatchNumber))

    this.emitLiveEvent({
      type: 'replan.completed',
      level: 'info',
      message: 'Replan completed',
      phase: 'planning',
      kind: 'progress',
      runId: currentRunId,
      totalPaths: reindexedPaths.length,
      meta: {
        batchNumber: this.runtime.currentBatchNumber,
        addedPaths: reindexedPaths.length,
      },
    })
    this.emitLiveEvent({
      type: 'batch.started',
      level: 'info',
      message: 'Path batch started',
      phase: 'planning',
      kind: 'progress',
      runId: currentRunId,
      totalPaths: reindexedPaths.length,
      meta: {
        batchNumber: this.runtime.currentBatchNumber,
      },
    })
  }
}
