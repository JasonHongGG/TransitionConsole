import express from 'express'
import cors from 'cors'
import { createLogger } from '../common/logger'
import { PlannedRunner } from './planned-runner'
import { shouldResetPlannerCursorOnStart } from './planned-runner/planner/plannerProvider/pathPlannerFactory'
import { createPlannedRoutes } from './routes/plannedRoutes'
import { AgentStepExecutor } from './planned-runner/executor'
import { BrowserOperatorApi } from './planned-runner/api/BrowserOperatorApi'
import { PathPlannerApi } from './planned-runner/api/PathPlannerApi'
import { StepNarratorApi } from './planned-runner/api/StepNarratorApi'

const log = createLogger('main-server')

export const startMainServer = (): void => {
  const app = express()
  app.use(cors())
  app.use(express.json({ limit: '2mb' }))

  const port = Number(process.env.PORT ?? 7070)

  const plannedRunner = new PlannedRunner({
    pathPlanner: new PathPlannerApi({
      aiBaseUrl: process.env.AI_SERVER_BASE_URL,
    }),
    resetPlannerCursorOnStart: shouldResetPlannerCursorOnStart(),
    executor: new AgentStepExecutor({
      narrator: new StepNarratorApi({ aiBaseUrl: process.env.AI_SERVER_BASE_URL }),
      operator: process.env.PLANNED_RUNNER_REAL_BROWSER === 'true'
        ? new BrowserOperatorApi({ operatorBaseUrl: process.env.OPERATOR_SERVER_BASE_URL })
        : undefined,
    }),
  })

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'main-server', mode: 'split' })
  })

  app.use('/api/planned', createPlannedRoutes(plannedRunner))

  app.listen(port, () => {
    log.log(`Main server listening on ${port}`, {
      mode: 'split',
      aiBaseUrl: process.env.AI_SERVER_BASE_URL ?? 'http://localhost:7081',
      operatorBaseUrl: process.env.OPERATOR_SERVER_BASE_URL ?? 'http://localhost:7082',
    })
  })
}
