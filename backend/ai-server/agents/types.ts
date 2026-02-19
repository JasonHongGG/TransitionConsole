import type {
  StepNarrativeInstruction,
} from '../../main-server/planned-runner/types'
import type { StepNarratorGenerateRequest } from '../../main-server/shared/contracts'
import type { LoopAppendFunctionResponsesInput, LoopDecision, LoopDecisionInput } from '../../main-server/planned-runner/executor/contracts'
import type { PathPlannerContext, PlannedPathDraft } from '../../main-server/planned-runner/planner/plannerProvider/types'

export interface PathPlannerAgent {
  generate(context: PathPlannerContext): Promise<PlannedPathDraft[]>
  reset(): Promise<void>
}

export interface StepNarratorAgent {
  generate(input: StepNarratorGenerateRequest): Promise<StepNarrativeInstruction>
  reset(): Promise<void>
}

export interface OperatorLoopDecisionAgent {
  decide(input: LoopDecisionInput): Promise<LoopDecision>
  appendFunctionResponses(input: LoopAppendFunctionResponsesInput): Promise<void>
  cleanupRun(runId: string): Promise<void>
  reset(): Promise<void>
}

export interface AiAgents {
  pathPlanner: PathPlannerAgent
  stepNarrator: StepNarratorAgent
  operatorLoop: OperatorLoopDecisionAgent
}
