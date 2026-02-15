import { createLogger } from '../../common/logger'
import type { ExecutorContext, PlannedTransitionStep, StepExecutionResult, StepExecutor } from '../types'
import type { BrowserOperator, InstructionPlanner, StepNarrator } from './contracts'
import { InstructionPlannerApi } from '../api/InstructionPlannerApi'
import { StepNarratorAgent } from './instruction/StepNarratorAgent'
import { PlaywrightBrowserOperator, SimulatedBrowserOperator } from './operators'

const log = createLogger('planned-executor')

export class AgentStepExecutor implements StepExecutor {
  private readonly narrator: StepNarrator
  private readonly planner: InstructionPlanner
  private readonly operator: BrowserOperator

  constructor(options?: { narrator?: StepNarrator; planner?: InstructionPlanner; operator?: BrowserOperator }) {
    this.narrator = options?.narrator ?? new StepNarratorAgent()
    this.planner = options?.planner ?? new InstructionPlannerApi()
    const realOperatorEnabled = process.env.PLANNED_RUNNER_REAL_BROWSER === 'true'
    this.operator = options?.operator ?? (realOperatorEnabled ? new PlaywrightBrowserOperator() : new SimulatedBrowserOperator())
  }

  async onRunStop(runId: string): Promise<void> {
    if (!this.operator.cleanupRun) return
    await this.operator.cleanupRun(runId)
  }

  async execute(step: PlannedTransitionStep, context: ExecutorContext): Promise<StepExecutionResult> {
    try {
      const narrative = await this.narrator.generate(step, context)
      const { instruction, assertions } = await this.planner.build(step, context)
      const operated = await this.operator.run(step, context, narrative, instruction, assertions)

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
        instruction,
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
