import { Router } from 'express'
import { createLogger } from '../common/logger'
import { PlannedRunner, type PlannedRunnerRequest } from '../planned-runner'
import type { PlannedLiveEventInput } from '../planned-runner/types'
import { PlannedLiveEventBus } from '../planned-runner/live-events/PlannedLiveEventBus'

const log = createLogger('api/planned')

export const createPlannedRoutes = (runner: PlannedRunner, liveEventBus: PlannedLiveEventBus): Router => {
  const router = Router()

  router.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n')
    }, 15000)

    const unsubscribe = liveEventBus.subscribe((event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`)
    })

    req.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
      res.end()
    })
  })

  router.post('/events/push', (req, res) => {
    const payload = req.body as PlannedLiveEventInput
    if (!payload || typeof payload.type !== 'string' || typeof payload.level !== 'string' || typeof payload.message !== 'string') {
      res.status(400).json({ ok: false, error: 'Invalid event payload' })
      return
    }

    liveEventBus.publish(payload)
    res.json({ ok: true })
  })

  router.post('/start', async (req, res) => {
    try {
      const payload = req.body as PlannedRunnerRequest
      log.log('start request received', {
        diagrams: payload?.diagrams?.length ?? 0,
        connectors: payload?.connectors?.length ?? 0,
        targetUrl: payload?.targetUrl ?? null,
        hasSpec: Boolean(payload?.specRaw),
      })

      const result = await runner.start(payload)
      log.log('start request completed', {
        ok: result.ok,
        running: result.snapshot.running,
        completed: result.snapshot.completed,
        totalPaths: result.snapshot.totalPaths,
      })
      res.json(result)
    } catch (error) {
      log.log('start request failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' })
    }
  })

  router.post('/step', async (_req, res) => {
    try {
      log.log('step request received')
      const result = await runner.step()
      log.log('step request completed', {
        ok: result.ok,
        completed: result.snapshot.completed,
        currentPathId: result.snapshot.currentPathId,
        currentStepId: result.snapshot.currentStepId,
        eventResult: result.event?.result ?? null,
        eventEdgeId: result.event?.step.edgeId ?? null,
      })
      res.json(result)
    } catch (error) {
      log.log('step request failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' })
    }
  })

  router.post('/stop', (_req, res) => {
    try {
      log.log('stop request received')
      const result = runner.stop()
      log.log('stop request completed', {
        ok: result.ok,
        completed: result.snapshot.completed,
        currentPathId: result.snapshot.currentPathId,
        currentStepId: result.snapshot.currentStepId,
      })
      res.json(result)
    } catch (error) {
      log.log('stop request failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' })
    }
  })

  router.post('/reset', async (_req, res) => {
    try {
      log.log('reset request received')
      const result = await runner.reset()
      log.log('reset request completed', {
        ok: result.ok,
        completed: result.snapshot.completed,
      })
      res.json(result)
    } catch (error) {
      log.log('reset request failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' })
    }
  })

  return router
}
