import { createLogger } from '../../common/logger'
import type { ExecutorContext, PlannedLiveEventInput, PlannedTransitionStep, StepExecutionResult, StepExecutor } from '../types'
import type { BrowserOperator, StepNarrator } from './contracts'
import { StepNarratorAgent } from './instruction/StepNarratorAgent'
import { PlaywrightBrowserOperator, SimulatedBrowserOperator } from './operators'

const log = createLogger('planned-executor')

export class AgentStepExecutor implements StepExecutor {
  private readonly narrator: StepNarrator
  private readonly operator: BrowserOperator
  private readonly publishLiveEvent?: (event: PlannedLiveEventInput) => void

  constructor(options?: {
    narrator?: StepNarrator
    operator?: BrowserOperator
    publishLiveEvent?: (event: PlannedLiveEventInput) => void
  }) {
    this.narrator = options?.narrator ?? new StepNarratorAgent()
    const realOperatorEnabled = process.env.PLANNED_RUNNER_REAL_BROWSER === 'true'
    this.operator = options?.operator ?? (realOperatorEnabled ? new PlaywrightBrowserOperator() : new SimulatedBrowserOperator())
    this.publishLiveEvent = options?.publishLiveEvent
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
        message: 'Step narrator started',
        runId: context.runId,
        pathId: context.pathId,
        stepId: context.stepId,
        edgeId: step.edgeId,
      })

      const narrative = await this.narrator.generate(step, context)

      this.emitLiveEvent({
        type: 'narrator.completed',
        level: 'success',
        message: narrative.taskDescription,
        runId: context.runId,
        pathId: context.pathId,
        stepId: context.stepId,
        edgeId: step.edgeId,
      })

      const assertions =
        narrative.assertions.length > 0
          ? narrative.assertions
          : context.stepValidations.map((validation, index) => ({
              id: `${step.edgeId}.assertion.${index + 1}`,
              type: 'semantic-check' as const,
              description: validation,
              expected: validation,
            }))

      this.emitLiveEvent({
        type: 'operator.started',
        level: 'info',
        message: 'Operator loop started',
        runId: context.runId,
        pathId: context.pathId,
        stepId: context.stepId,
        edgeId: step.edgeId,
      })

      const operated = await this.operator.run(step, context, narrative, assertions)

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
        assertions,
        loopIterations: operated.trace.map((item) => ({
          iteration: item.iteration,
          url: item.observation,
          stateSummary: item.observation,
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
        failureCode: 'unexpected-error',
        validationResults: [],
      }
    }
  }
}

export class StubStepExecutor extends AgentStepExecutor {}
