import { createLogger } from '../../common/logger'
import type {
  DiagramConnector,
  DiagramTransition,
  ExecutorContext,
  PathExecutionResult,
  PathExecutor,
  PlannedLiveEventInput,
  PlannedTransitionPath,
  StepNarrativeInstruction,
  StepValidationSpec,
} from '../types'
import type { BrowserOperator, PathNarrator } from './contracts'

const log = createLogger('planned-executor')

const toElapsedSeconds = (elapsedMs: number): number => Math.max(1, Math.ceil(elapsedMs / 1000))

type NarrativeCandidate = {
  summary: string
  taskDescription: string
  validations: StepValidationSpec[]
}

export class AgentStepExecutor implements PathExecutor {
  private readonly narrator: PathNarrator
  private readonly operator: BrowserOperator
  private readonly narratorMode: 'agent' | 'input'
  private readonly publishLiveEvent?: (event: PlannedLiveEventInput) => void

  constructor(options?: {
    narrator?: PathNarrator
    operator?: BrowserOperator
    publishLiveEvent?: (event: PlannedLiveEventInput) => void
  }) {
    if (!options?.narrator) {
      throw new Error('AgentStepExecutor requires narrator injection (use PathNarratorApi)')
    }
    if (!options?.operator) {
      throw new Error('AgentStepExecutor requires operator injection (use BrowserOperatorApi)')
    }
    this.narrator = options.narrator
    this.operator = options.operator
    this.narratorMode = (process.env.PATH_NARRATOR_MODE ?? 'agent').trim().toLowerCase() === 'input' ? 'input' : 'agent'
    this.publishLiveEvent = options?.publishLiveEvent
  }

  private emitLiveEvent(event: PlannedLiveEventInput): void {
    this.publishLiveEvent?.(event)
  }

  private collectStepConnectorCandidates(step: PlannedTransitionPath['steps'][number], context: ExecutorContext): DiagramConnector[] {
    const connectorCandidatesFromContext = context.systemConnectors.filter((connector) => connector.id === step.edgeId)

    const connectorCandidatesFromDiagrams = context.systemDiagrams.flatMap((diagram) =>
      (diagram.connectors ?? []).filter((connector) => connector.id === step.edgeId),
    )

    return [...connectorCandidatesFromContext, ...connectorCandidatesFromDiagrams]
  }

  private buildTransitionNarrativeFromInput(
    step: PlannedTransitionPath['steps'][number],
    context: ExecutorContext,
  ): { ok: true; candidate: NarrativeCandidate } | { ok: false; reason: string } {
    const transitionMatches: DiagramTransition[] = context.systemDiagrams.flatMap((diagram) =>
      diagram.transitions.filter((transition) => transition.id === step.edgeId),
    )

    const connectorMatches = this.collectStepConnectorCandidates(step, context)

    const transitionLike = transitionMatches[0] as (DiagramTransition & {
      narrative?: { summary?: string; taskDescription?: string }
    }) | undefined

    const connectorLike = connectorMatches[0] as (DiagramConnector & {
      narrative?: { summary?: string; taskDescription?: string }
    }) | undefined

    const summary = transitionLike?.narrative?.summary?.trim() || connectorLike?.narrative?.summary?.trim() || step.label
    const taskDescription =
      transitionLike?.narrative?.taskDescription?.trim() ||
      connectorLike?.narrative?.taskDescription?.trim() ||
      `Execute transition ${step.label}`

    const stepValidations = step.validations
    const transitionValidations = transitionLike?.validations ?? []
    const connectorValidations = connectorLike?.validations ?? []

    const validations = stepValidations.length > 0 ? stepValidations : [...transitionValidations, ...connectorValidations]

    if (validations.length === 0) {
      return {
        ok: false,
        reason: `input mode requires transition/connector validations for edgeId=${step.edgeId}`,
      }
    }

    return {
      ok: true,
      candidate: {
        summary,
        taskDescription,
        validations,
      },
    }
  }

  private buildPathNarrativeFromInput(
    path: PlannedTransitionPath,
    context: ExecutorContext,
  ): { ok: true; narrative: StepNarrativeInstruction } | { ok: false; reason: string } {
    const transitions: NonNullable<StepNarrativeInstruction['transitions']> = []
    const flattenedValidations = new Map<string, StepValidationSpec>()

    for (const step of path.steps) {
      const built = this.buildTransitionNarrativeFromInput(step, context)
      if (built.ok === false) {
        return built
      }

      transitions.push({
        stepId: step.id,
        edgeId: step.edgeId,
        summary: built.candidate.summary,
        taskDescription: built.candidate.taskDescription,
        validations: built.candidate.validations,
      })

      built.candidate.validations.forEach((validation) => {
        flattenedValidations.set(`${step.id}:${validation.id}`, validation)
      })
    }

    return {
      ok: true,
      narrative: {
        summary: path.semanticGoal || path.name,
        taskDescription: `Execute path ${path.name}`,
        executionStrategy: 'Use a single browser session for the whole path. Advance only when the current transition validations pass.',
        validations: Array.from(flattenedValidations.values()),
        transitions,
      },
    }
  }

  async onRunStop(runId: string): Promise<void> {
    if (!this.operator.cleanupRun) return
    await this.operator.cleanupRun(runId)
  }

  async cleanupPath(runId: string, pathExecutionId: string, pathId: string): Promise<void> {
    if (!this.operator.cleanupPath) return
    await this.operator.cleanupPath(runId, pathExecutionId, pathId)
  }

  async onRunnerReset(): Promise<void> {
    if (this.narrator.resetReplayCursor) {
      await this.narrator.resetReplayCursor()
    }
    if (this.operator.resetReplayCursor) {
      await this.operator.resetReplayCursor()
    }
  }

  async executePath(path: PlannedTransitionPath, context: ExecutorContext): Promise<PathExecutionResult> {
    try {
      this.emitLiveEvent({
        type: 'narrator.started',
        level: 'info',
        message: this.narratorMode === 'input' ? 'Path narrator started (input mode)' : 'Path narrator started',
        phase: 'narrating',
        kind: 'progress',
        runId: context.runId,
        pathId: context.pathId,
        pathName: context.pathName,
        pathExecutionId: context.pathExecutionId,
        attemptId: context.attemptId,
        semanticGoal: context.semanticGoal,
      })

      const narratorStartedAt = Date.now()
      const narrative =
        this.narratorMode === 'input'
          ? (() => {
              const built = this.buildPathNarrativeFromInput(path, context)
              if (built.ok === false) {
                throw new Error(built.reason)
              }
              return built.narrative
            })()
          : await this.narrator.generate(path, context)
      const narratorElapsedMs = Date.now() - narratorStartedAt
      const narratorElapsedSeconds = toElapsedSeconds(narratorElapsedMs)

      this.emitLiveEvent({
        type: 'narrator.completed',
        level: 'success',
        message: 'Path narrator completed',
        phase: 'narrating',
        kind: 'progress',
        runId: context.runId,
        pathId: context.pathId,
        pathName: context.pathName,
        pathExecutionId: context.pathExecutionId,
        attemptId: context.attemptId,
        semanticGoal: context.semanticGoal,
      })

      this.emitLiveEvent({
        type: 'agent.generation.completed',
        level: 'success',
        message: this.narratorMode === 'input'
          ? `[path-narrator:input] 讀取完成，花費 ${narratorElapsedSeconds}s`
          : `[path-narrator] 生成完成，花費 ${narratorElapsedSeconds}s`,
        phase: 'narrating',
        kind: 'progress',
        runId: context.runId,
        pathId: context.pathId,
        pathName: context.pathName,
        pathExecutionId: context.pathExecutionId,
        attemptId: context.attemptId,
        semanticGoal: context.semanticGoal,
        meta: {
          agentTag: this.narratorMode === 'input' ? 'path-narrator-input' : 'path-narrator',
          elapsedMs: narratorElapsedMs,
          elapsedSeconds: narratorElapsedSeconds,
        },
      })

      if ((narrative.transitions?.length ?? 0) === 0 && path.steps.length > 0) {
        return {
          result: 'fail',
          blockedReason: `No path transition narratives resolved for pathId=${path.id}`,
          failureCode: 'narrative-planner-failed',
          terminationReason: 'criteria-unmet',
          transitionResults: [],
          finalStateId: path.steps[0]?.fromStateId ?? null,
        }
      }

      this.emitLiveEvent({
        type: 'operator.started',
        level: 'info',
        message: 'Path operator loop started',
        phase: 'operating',
        kind: 'progress',
        runId: context.runId,
        pathId: context.pathId,
        pathName: context.pathName,
        pathExecutionId: context.pathExecutionId,
        attemptId: context.attemptId,
        semanticGoal: context.semanticGoal,
      })

      const operated = await this.operator.runPath(path, context, narrative)

      this.emitLiveEvent({
        type: 'operator.completed',
        level: operated.result === 'pass' ? 'success' : 'error',
        message: operated.result === 'pass' ? 'Path operator loop completed' : (operated.blockedReason ?? 'Path operator loop failed'),
        phase: operated.result === 'pass' ? 'validating' : 'failed',
        kind: operated.result === 'pass' ? 'progress' : 'issue',
        runId: context.runId,
        pathId: context.pathId,
        pathName: context.pathName,
        pathExecutionId: context.pathExecutionId,
        attemptId: context.attemptId,
        semanticGoal: context.semanticGoal,
        blockedReason: operated.blockedReason,
        failureCode: operated.failureCode,
        terminationReason: operated.terminationReason,
      })

      log.log('path executed by agent executor', {
        runId: context.runId,
        pathId: context.pathId,
        pathExecutionId: context.pathExecutionId,
        result: operated.result,
      })

      return {
        result: operated.result,
        blockedReason: operated.blockedReason,
        failureCode: operated.failureCode,
        terminationReason: operated.terminationReason ?? (operated.result === 'pass' ? 'completed' : 'criteria-unmet'),
        transitionResults: operated.transitionResults,
        finalStateId: operated.finalStateId,
      }
    } catch (error) {
      this.emitLiveEvent({
        type: 'executor.failed',
        level: 'error',
        message: error instanceof Error ? error.message : 'agent executor failed',
        phase: 'failed',
        kind: 'issue',
        runId: context.runId,
        pathId: context.pathId,
        pathName: context.pathName,
        pathExecutionId: context.pathExecutionId,
        attemptId: context.attemptId,
        semanticGoal: context.semanticGoal,
        blockedReason: error instanceof Error ? error.message : 'agent executor failed',
      })

      return {
        result: 'fail',
        blockedReason: error instanceof Error ? error.message : 'agent executor failed',
        failureCode:
          error instanceof Error && error.message.includes('input mode requires')
            ? 'narrative-planner-failed'
            : 'unexpected-error',
        transitionResults: [],
        finalStateId: path.steps[0]?.fromStateId ?? null,
      }
    }
  }
}

export class StubStepExecutor extends AgentStepExecutor {}
