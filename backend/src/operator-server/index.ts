import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { createLogger } from '../common/logger'
import { PlaywrightBrowserOperator } from './operators/PlaywrightBrowserOperator'
import type {
  OperatorCleanupPathRequest,
  OperatorCleanupRunRequest,
  OperatorPathRunRequest,
  OperatorResetReplayResponse,
  PlannedLiveEventInput,
} from './type'
import { OperatorLoopApi } from './OperatorLoopApi'
import { servicePorts, toLocalBaseUrl } from '../common/network'

const log = createLogger('operator-server')
const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))

const mainServerBaseUrl = toLocalBaseUrl(servicePorts.mainServer)
const aiServerBaseUrl = toLocalBaseUrl(servicePorts.aiServer)

const pushLiveEvent = async (event: PlannedLiveEventInput): Promise<void> => {
  try {
    await fetch(`${mainServerBaseUrl}/api/planned/events/push`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(event),
    })
  } catch (error) {
    log.log('operator live event push failed', {
      error: error instanceof Error ? error.message : 'live event push failed',
      type: event.type,
      runId: event.runId,
    })
  }
}

const operator = new PlaywrightBrowserOperator({
  loopAgent: new OperatorLoopApi({
    aiBaseUrl: aiServerBaseUrl,
  }),
  onLiveEvent: (event) => {
    void pushLiveEvent(event)
  },
})

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'operator-server' })
})

app.post('/api/operator/path-executor/run', async (req, res) => {
  try {
    const body = req.body as OperatorPathRunRequest
    const path = body.path
    const context = body.context
    const narrative = body.narrative

    log.log('operator run request', {
      runId: context.runId,
      pathId: context.pathId,
      pathExecutionId: context.pathExecutionId,
      transitions: path.steps.length,
      targetUrl: context.targetUrl,
    })

    const output = await operator.runPath(path, context, narrative)
    log.log('operator run completed', {
      runId: context.runId,
      pathId: context.pathId,
      pathExecutionId: context.pathExecutionId,
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

app.post('/api/operator/path-executor/cleanup-run', async (req, res) => {
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

app.post('/api/operator/path-executor/cleanup-path', async (req, res) => {
  try {
    const { runId, pathExecutionId, pathId } = req.body as OperatorCleanupPathRequest
    log.log('operator path cleanup request', { runId, pathExecutionId, pathId })
    await operator.cleanupPath?.(runId, pathExecutionId)
    log.log('operator path cleanup completed', { runId, pathExecutionId, pathId })
    res.json({ ok: true })
  } catch (error) {
    log.log('operator path cleanup failed', {
      error: error instanceof Error ? error.message : 'operator path cleanup failed',
    })
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'operator path cleanup failed',
    })
  }
})

app.post('/api/operator/path-executor/reset-replay', async (_req, res) => {
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

const port = servicePorts.operatorServer
app.listen(port, () => {
  log.log('Operator server listening', {
    port,
  })
})
