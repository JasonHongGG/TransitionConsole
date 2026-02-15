import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { createLogger } from '../common/logger'
import { PlaywrightBrowserOperator } from '../main-server/planned-runner/executor/operators/PlaywrightBrowserOperator'
import type { OperatorCleanupRunRequest, OperatorStepRunRequest } from '../main-server/shared/contracts'
import { HttpOperatorLoopAgent } from './HttpOperatorLoopAgent'

const log = createLogger('operator-server')
const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))

const operator = new PlaywrightBrowserOperator({
  loopAgent: new HttpOperatorLoopAgent({
    aiBaseUrl: process.env.AI_SERVER_BASE_URL,
  }),
})

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'operator-server' })
})

app.post('/api/operator/step-executor/run', async (req, res) => {
  try {
    const body = req.body as OperatorStepRunRequest
    const step = body.step
    const context = body.context
    const narrative = body.narrative
    const instruction = body.instruction
    const assertions = body.assertions

    const output = await operator.run(step, context, narrative, instruction, assertions)
    res.json(output)
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'operator run failed',
    })
  }
})

app.post('/api/operator/step-executor/cleanup-run', async (req, res) => {
  try {
    await operator.cleanupRun?.((req.body as OperatorCleanupRunRequest).runId)
    res.json({ ok: true })
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'operator cleanup failed',
    })
  }
})

const port = Number(process.env.OPERATOR_SERVER_PORT ?? 7082)
app.listen(port, () => {
  log.log(`Operator server listening on ${port}`)
})
