import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { createLogger } from '../common/logger'
import { PlaywrightBrowserOperator } from '../main-server/planned-runner/executor/operators/PlaywrightBrowserOperator'
import type { OperatorCleanupRunRequest, OperatorResetReplayResponse, OperatorStepRunRequest } from '../main-server/shared/contracts'
import { OperatorLoopApi } from './OperatorLoopApi'

const log = createLogger('operator-server')
const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))

const operator = new PlaywrightBrowserOperator({
  loopAgent: new OperatorLoopApi({
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
    const assertions = body.assertions

    log.log('operator run request', {
      runId: context.runId,
      pathId: context.pathId,
      stepId: context.stepId,
      edgeId: step.edgeId,
      targetUrl: context.targetUrl,
    })

    const output = await operator.run(step, context, narrative, assertions)
    log.log('operator run completed', {
      runId: context.runId,
      pathId: context.pathId,
      stepId: context.stepId,
      edgeId: step.edgeId,
      result: output.result,
    })
    res.json(output)
  } catch (error) {
    log.log('operator run failed', {
      error: error instanceof Error ? error.message : 'operator run failed',
    })
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'operator run failed',
    })
  }
})

app.post('/api/operator/step-executor/cleanup-run', async (req, res) => {
  try {
    const runId = (req.body as OperatorCleanupRunRequest).runId
    log.log('operator cleanup request', { runId })
    await operator.cleanupRun?.(runId)
    log.log('operator cleanup completed', { runId })
    res.json({ ok: true })
  } catch (error) {
    log.log('operator cleanup failed', {
      error: error instanceof Error ? error.message : 'operator cleanup failed',
    })
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'operator cleanup failed',
    })
  }
})

app.post('/api/operator/step-executor/reset-replay', async (_req, res) => {
  try {
    log.log('operator replay reset request')
    await operator.resetReplayCursor?.()
    log.log('operator replay reset completed')
    res.json({ ok: true } satisfies OperatorResetReplayResponse)
  } catch (error) {
    log.log('operator replay reset failed', {
      error: error instanceof Error ? error.message : 'operator replay reset failed',
    })
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'operator replay reset failed',
    })
  }
})

const port = Number(process.env.OPERATOR_SERVER_PORT ?? 7082)
app.listen(port, () => {
  log.log(`Operator server listening on ${port}`)
})
