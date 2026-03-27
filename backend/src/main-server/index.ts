import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { createLogger } from '../common/logger'
import { PlannedRunner } from './planned-runner'
import { createPlannedRoutes } from './routes/plannedRoutes'
import { AgentStepExecutor } from './planned-runner/executor'
import { PassOnlyStepExecutor } from './planned-runner/executor/PassOnlyStepExecutor'
import { BrowserOperatorApi } from './planned-runner/api/BrowserOperatorApi'
import { PathPlannerApi } from './planned-runner/api/PathPlannerApi'
import { PathNarratorApi } from './planned-runner/api/PathNarratorApi'
import { PlannedLiveEventBus } from './planned-runner/live-events/PlannedLiveEventBus'
import type { RunnerAgentModes } from './planned-runner/types'
import { servicePorts, toLocalBaseUrl } from '../common/network'

const log = createLogger('main-server')

export const startMainServer = (): void => {
  const app = express()
  app.use(cors())
  app.use(express.json({ limit: '2mb' }))

  const port = servicePorts.mainServer
  const aiServerBaseUrl = toLocalBaseUrl(servicePorts.aiServer)
  const operatorServerBaseUrl = toLocalBaseUrl(servicePorts.operatorServer)
  const liveEventBus = new PlannedLiveEventBus()
  const executorMode = (process.env.PLANNED_RUNNER_EXECUTOR_MODE ?? 'agent').trim().toLowerCase()
  const resolveMode = (provider: string | undefined): 'llm' | 'mock' =>
    (provider ?? 'llm').trim().toLowerCase() === 'mock-replay' ? 'mock' : 'llm'

  const defaultAgentModes: RunnerAgentModes = {
    pathPlanner: resolveMode(process.env.PATH_PLANNER_PROVIDER),
    pathNarrator: resolveMode(process.env.PATH_NARRATOR_PROVIDER),
    operatorLoop: resolveMode(process.env.OPERATOR_LOOP_PROVIDER),
  }

  const executor =
    executorMode === 'pass-only'
      ? new PassOnlyStepExecutor()
      : new AgentStepExecutor({
          narrator: new PathNarratorApi({ aiBaseUrl: aiServerBaseUrl }),
          operator: new BrowserOperatorApi({ operatorBaseUrl: operatorServerBaseUrl }),
          publishLiveEvent: (event) => {
            liveEventBus.publish(event)
          },
        })

  const plannedRunner = new PlannedRunner({
    pathPlanner: new PathPlannerApi({
      aiBaseUrl: aiServerBaseUrl,
    }),
    executor,
    publishLiveEvent: (event) => {
      liveEventBus.publish(event)
    },
    defaultAgentModes,
  })

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'main-server', mode: 'split' })
  })

  app.use('/api/planned', createPlannedRoutes(plannedRunner, liveEventBus))

  app.listen(port, () => {
    log.log('Main server listening', {
      port,
      mode: 'split',
      executorMode,
      aiBaseUrl: aiServerBaseUrl,
      operatorBaseUrl: operatorServerBaseUrl,
      defaultAgentModes,
    })
  })
}

startMainServer()
