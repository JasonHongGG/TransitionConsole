import type { AiRuntime } from '../runtime/types'
import type { AiAgents } from './types'
import { DefaultPathPlannerAgent } from './path-planner/PathPlannerAgent'
import { DefaultStepNarratorAgent } from './step-narrator/StepNarratorAgent'
import { DefaultOperatorLoopDecisionAgent } from './operator-loop/OperatorLoopDecisionAgent'

export const createAiAgents = (runtime: AiRuntime): AiAgents => ({
  pathPlanner: new DefaultPathPlannerAgent(runtime),
  stepNarrator: new DefaultStepNarratorAgent(runtime),
  operatorLoop: new DefaultOperatorLoopDecisionAgent(runtime),
})
