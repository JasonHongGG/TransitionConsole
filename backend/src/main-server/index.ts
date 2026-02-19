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
import { StepNarratorApi } from './planned-runner/api/StepNarratorApi'
import { PlannedLiveEventBus } from './planned-runner/live-events/PlannedLiveEventBus'

const log = createLogger('main-server')

export const startMainServer = (): void => {
  const app = express()
  app.use(cors())
  app.use(express.json({ limit: '2mb' }))

  const port = Number(process.env.MAIN_SERVER_PORT ?? 7070)
  const liveEventBus = new PlannedLiveEventBus()
  const executorMode = (process.env.PLANNED_RUNNER_EXECUTOR_MODE ?? 'agent').trim().toLowerCase()

  const executor =
    executorMode === 'pass-only'
      ? new PassOnlyStepExecutor()
      : new AgentStepExecutor({
          narrator: new StepNarratorApi({ aiBaseUrl: process.env.AI_SERVER_BASE_URL }),
          operator: new BrowserOperatorApi({ operatorBaseUrl: process.env.OPERATOR_SERVER_BASE_URL }),
          publishLiveEvent: (event) => {
            liveEventBus.publish(event)
          },
        })

  const plannedRunner = new PlannedRunner({
    pathPlanner: new PathPlannerApi({
      aiBaseUrl: process.env.AI_SERVER_BASE_URL,
    }),
    executor,
    publishLiveEvent: (event) => {
      liveEventBus.publish(event)
    },
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
      aiBaseUrl: process.env.AI_SERVER_BASE_URL ?? 'http://localhost:7081',
      operatorBaseUrl: process.env.OPERATOR_SERVER_BASE_URL ?? 'http://localhost:7082',
    })
  })
}

startMainServer()
