import type { AiRuntime } from '../runtime/types'
import type { AiAgents } from './types'
import { DefaultPathPlannerAgent } from './path-planner/PathPlannerAgent'
import { DefaultPathNarratorAgent } from './path-narrator/PathNarratorAgent'
import { DefaultOperatorLoopDecisionAgent } from './operator-loop/OperatorLoopDecisionAgent'

export const createAiAgents = (runtime: AiRuntime): AiAgents => ({
  pathPlanner: new DefaultPathPlannerAgent(runtime),
  pathNarrator: new DefaultPathNarratorAgent(runtime),
  operatorLoop: new DefaultOperatorLoopDecisionAgent(runtime),
})
