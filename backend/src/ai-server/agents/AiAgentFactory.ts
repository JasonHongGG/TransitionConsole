import type { AiRuntime } from '../runtime/types'
import type { AiAgents } from './types'
import { DefaultPathPlannerAgent } from './path-planner/PathPlannerAgent'
import { DefaultPathNarratorAgent } from './path-narrator/PathNarratorAgent'
import { DefaultOperatorLoopDecisionAgent } from './operator-loop/OperatorLoopDecisionAgent'

import { createAiRuntime } from '../runtime/AiRuntimeFactory'

export const createAiAgents = (defaultRuntime: AiRuntime): AiAgents => {
  const plannerRuntime = process.env.PATH_PLANNER_AI_PROVIDER
    ? createAiRuntime({ provider: process.env.PATH_PLANNER_AI_PROVIDER })
    : defaultRuntime

  const narratorRuntime = process.env.PATH_NARRATOR_AI_PROVIDER
    ? createAiRuntime({ provider: process.env.PATH_NARRATOR_AI_PROVIDER })
    : defaultRuntime

  const loopRuntime = process.env.OPERATOR_LOOP_AI_PROVIDER
    ? createAiRuntime({ provider: process.env.OPERATOR_LOOP_AI_PROVIDER })
    : defaultRuntime

  return {
    pathPlanner: new DefaultPathPlannerAgent(plannerRuntime),
    pathNarrator: new DefaultPathNarratorAgent(narratorRuntime),
    operatorLoop: new DefaultOperatorLoopDecisionAgent(loopRuntime),
  }
}
