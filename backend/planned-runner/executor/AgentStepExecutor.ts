import { createLogger } from '../../common/logger'
import type { ExecutorContext, PlannedTransitionStep, StepExecutionResult, StepExecutor } from '../types'
import type { BrowserOperator, InstructionPlanner } from './contracts'
import { CopilotInstructionPlanner } from './instruction/CopilotInstructionPlanner'
import { PlaywrightBrowserOperator } from './operators/PlaywrightBrowserOperator'
import { SimulatedBrowserOperator } from './operators/SimulatedBrowserOperator'

const log = createLogger('planned-executor')

export class AgentStepExecutor implements StepExecutor {
  private readonly planner: InstructionPlanner
  private readonly operator: BrowserOperator

  constructor(options?: { planner?: InstructionPlanner; operator?: BrowserOperator }) {
    this.planner = options?.planner ?? new CopilotInstructionPlanner()
    const realOperatorEnabled = process.env.PLANNED_RUNNER_REAL_BROWSER === 'true'
    this.operator = options?.operator ?? (realOperatorEnabled ? new PlaywrightBrowserOperator() : new SimulatedBrowserOperator())
  }

  async onRunStop(runId: string): Promise<void> {
    if (!this.operator.cleanupRun) return
    await this.operator.cleanupRun(runId)
  }

  async execute(step: PlannedTransitionStep, context: ExecutorContext): Promise<StepExecutionResult> {
    try {
      const { instruction, assertions } = await this.planner.build(step, context)
      const operated = await this.operator.run(step, context, instruction, assertions)

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
        instruction,
        assertions,
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
