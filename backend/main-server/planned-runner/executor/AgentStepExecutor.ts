import { createLogger } from '../../common/logger'
import type {
  DiagramConnector,
  DiagramTransition,
  ExecutorContext,
  PlannedLiveEventInput,
  PlannedTransitionStep,
  StepExecutionResult,
  StepExecutor,
  StepNarrativeInstruction,
} from '../types'
import type { BrowserOperator, StepNarrator } from './contracts'

const log = createLogger('planned-executor')

const toElapsedSeconds = (elapsedMs: number): number => Math.max(1, Math.ceil(elapsedMs / 1000))

export class AgentStepExecutor implements StepExecutor {
  private readonly narrator: StepNarrator
  private readonly operator: BrowserOperator
  private readonly narratorMode: 'agent' | 'input'
  private readonly publishLiveEvent?: (event: PlannedLiveEventInput) => void

  constructor(options?: {
    narrator?: StepNarrator
    operator?: BrowserOperator
    publishLiveEvent?: (event: PlannedLiveEventInput) => void
  }) {
    if (!options?.narrator) {
      throw new Error('AgentStepExecutor requires narrator injection (use StepNarratorApi)')
    }
    if (!options?.operator) {
      throw new Error('AgentStepExecutor requires operator injection (use BrowserOperatorApi)')
    }
    this.narrator = options.narrator
    this.operator = options.operator
    this.narratorMode = (process.env.STEP_NARRATOR_MODE ?? 'agent').trim().toLowerCase() === 'input' ? 'input' : 'agent'
    this.publishLiveEvent = options?.publishLiveEvent
  }

  private collectStepConnectorCandidates(step: PlannedTransitionStep, context: ExecutorContext): DiagramConnector[] {
    const connectorCandidatesFromContext = context.systemConnectors.filter((connector) => connector.id === step.edgeId)

    const connectorCandidatesFromDiagrams = context.systemDiagrams.flatMap((diagram) =>
      (diagram.connectors ?? []).filter((connector) => connector.id === step.edgeId),
    )

    return [...connectorCandidatesFromContext, ...connectorCandidatesFromDiagrams]
  }

  private buildNarrativeFromInput(
    step: PlannedTransitionStep,
    context: ExecutorContext,
  ): { ok: true; narrative: StepNarrativeInstruction } | { ok: false; reason: string } {
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

    const summary = transitionLike?.narrative?.summary?.trim() || connectorLike?.narrative?.summary?.trim() || ''
    const taskDescription =
      transitionLike?.narrative?.taskDescription?.trim() || connectorLike?.narrative?.taskDescription?.trim() || ''

    const stepValidations = step.validations
    const transitionValidations = transitionLike?.validations ?? []
    const connectorValidations = connectorLike?.validations ?? []

    const validations = stepValidations.length > 0 ? stepValidations : [...transitionValidations, ...connectorValidations]

    if (!summary || !taskDescription) {
      return {
        ok: false,
        reason: `input mode requires transition/connector narrative.summary and narrative.taskDescription for edgeId=${step.edgeId}`,
      }
    }

    if (validations.length === 0) {
      return {
        ok: false,
        reason: `input mode requires transition/connector validations for edgeId=${step.edgeId}`,
      }
    }

    return {
      ok: true,
      narrative: {
        summary,
        taskDescription,
        validations,
      },
    }
  }

  private emitLiveEvent(event: PlannedLiveEventInput): void {
    this.publishLiveEvent?.(event)
  }

  async onRunStop(runId: string): Promise<void> {
    if (!this.operator.cleanupRun) return
    await this.operator.cleanupRun(runId)
  }

  async onRunnerReset(): Promise<void> {
    if (this.narrator.resetReplayCursor) {
      await this.narrator.resetReplayCursor()
    }
    if (this.operator.resetReplayCursor) {
      await this.operator.resetReplayCursor()
    }
  }

  async execute(step: PlannedTransitionStep, context: ExecutorContext): Promise<StepExecutionResult> {
    try {
      this.emitLiveEvent({
        type: 'narrator.started',
        level: 'info',
        message: this.narratorMode === 'input' ? 'Step narrator started (input mode)' : 'Step narrator started',
        runId: context.runId,
        pathId: context.pathId,
        stepId: context.stepId,
        edgeId: step.edgeId,
      })

      const narratorStartedAt = Date.now()
      const narrative =
        this.narratorMode === 'input'
          ? (() => {
              const built = this.buildNarrativeFromInput(step, context)
              if (built.ok === false) {
                throw new Error(built.reason)
              }
              return built.narrative
            })()
          : await this.narrator.generate(step, context)
      const narratorElapsedMs = Date.now() - narratorStartedAt
      const narratorElapsedSeconds = toElapsedSeconds(narratorElapsedMs)

      this.emitLiveEvent({
        type: 'narrator.completed',
        level: 'success',
        message: 'Step narrator completed',
        runId: context.runId,
        pathId: context.pathId,
        stepId: context.stepId,
        edgeId: step.edgeId,
      })

      this.emitLiveEvent({
        type: 'agent.generation.completed',
        level: 'success',
        message: this.narratorMode === 'input'
          ? `[step-narrator:input] 讀取完成，花費 ${narratorElapsedSeconds}s`
          : `[step-narrator] 生成完成，花費 ${narratorElapsedSeconds}s`,
        runId: context.runId,
        pathId: context.pathId,
        stepId: context.stepId,
        edgeId: step.edgeId,
        meta: {
          agentTag: this.narratorMode === 'input' ? 'step-narrator-input' : 'step-narrator',
          elapsedMs: narratorElapsedMs,
          elapsedSeconds: narratorElapsedSeconds,
        },
      })

      const validations =
        narrative.validations.length > 0
          ? narrative.validations
          : context.stepValidations

      if (validations.length === 0) {
        return {
          result: 'fail',
          blockedReason: `No validations resolved for edgeId=${step.edgeId}`,
          failureCode: 'narrative-planner-failed',
          terminationReason: 'criteria-unmet',
          validationResults: [],
        }
      }

      this.emitLiveEvent({
        type: 'operator.started',
        level: 'info',
        message: 'Operator loop started',
        runId: context.runId,
        pathId: context.pathId,
        stepId: context.stepId,
        edgeId: step.edgeId,
      })

      const operated = await this.operator.run(step, context, narrative, validations)

      this.emitLiveEvent({
        type: 'operator.completed',
        level: operated.result === 'pass' ? 'success' : 'error',
        message: operated.result === 'pass' ? 'Operator loop completed' : (operated.blockedReason ?? 'Operator loop failed'),
        runId: context.runId,
        pathId: context.pathId,
        stepId: context.stepId,
        edgeId: step.edgeId,
      })

      log.log('step executed by agent executor', {
        runId: context.runId,
        pathId: context.pathId,
        stepId: context.stepId,
        edgeId: step.edgeId,
        result: operated.result,
      })

      return {
        result: operated.result,
        blockedReason: operated.blockedReason,
        failureCode: operated.failureCode,
        validationResults: operated.validationResults,
        narrative,
        validations,
        loopIterations: operated.trace.map((item) => ({
          iteration: item.iteration,
          url: item.url,
          observationSummary: item.observation,
          action: item.action,
          functionCall: item.functionCall,
          outcome: item.outcome,
          detail: item.detail,
        })),
        terminationReason: operated.terminationReason ?? (operated.result === 'pass' ? 'completed' : 'criteria-unmet'),
        trace: operated.trace,
        evidence: operated.evidence,
      }
    } catch (error) {
      this.emitLiveEvent({
        type: 'executor.failed',
        level: 'error',
        message: error instanceof Error ? error.message : 'agent executor failed',
        runId: context.runId,
        pathId: context.pathId,
        stepId: context.stepId,
        edgeId: step.edgeId,
      })

      return {
        result: 'fail',
        blockedReason: error instanceof Error ? error.message : 'agent executor failed',
        failureCode:
          error instanceof Error && error.message.includes('input mode requires')
            ? 'narrative-planner-failed'
            : 'unexpected-error',
        validationResults: [],
      }
    }
  }
}

export class StubStepExecutor extends AgentStepExecutor {}
