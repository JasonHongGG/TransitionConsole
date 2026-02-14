import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { createLogger } from './common/logger'
import { PlannedRunner } from './planned-runner'
import { createPlannedRoutes } from './routes/plannedRoutes'

const app = express()
app.use(cors())
app.use(express.json({ limit: '2mb' }))

const log = createLogger('server')

const port = Number(process.env.PORT ?? 7070)
const plannedRunner = new PlannedRunner()

app.use('/api/planned', createPlannedRoutes(plannedRunner))

app.listen(port, () => {
  log.log(`Planned runner server listening on ${port}`)
})
