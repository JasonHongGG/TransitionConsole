import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { createLogger } from '../common/logger'
import type {
  OperatorLoopAppendFunctionResponsesRequest,
  OperatorLoopCleanupRunRequest,
  OperatorLoopDecideRequest,
  PathPlannerGenerateRequest,
  StepNarratorGenerateRequest,
} from '../main-server/shared/contracts'
import { createAiRuntime } from './runtime/AiRuntimeFactory'
import { createAiAgents } from './agents/AiAgentFactory'

const log = createLogger('ai-server')
const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))

const runtime = createAiRuntime()
const agents = createAiAgents(runtime)
const providerId = (process.env.AI_PROVIDER ?? 'copilot-sdk').trim().toLowerCase()

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'ai-server', provider: providerId })
})

app.post('/api/ai/path-planner/generate', async (req, res) => {
  try {
    const context = (req.body as PathPlannerGenerateRequest | undefined)?.context
    if (!context) {
      log.log('path planner generate rejected: missing context')
      res.status(400).json({ ok: false, error: 'context is required' })
      return
    }
    log.log('path planner generate request', {
      diagrams: context.context.diagrams.length,
      targetUrl: context.context.targetUrl,
    })
    const paths = await agents.pathPlanner.generate(context)
    log.log('path planner generate completed', {
      totalPaths: paths.length,
    })
    res.json({ paths })
  } catch (error) {
    log.log('path planner generate failed', {
      error: error instanceof Error ? error.message : 'path planner failed',
    })
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'path planner failed',
    })
  }
})

app.post('/api/ai/path-planner/reset', async (_req, res) => {
  try {
    log.log('path planner reset request')
    await agents.pathPlanner.reset()
    log.log('path planner reset completed')
    res.json({ ok: true })
  } catch (error) {
    log.log('path planner reset failed', {
      error: error instanceof Error ? error.message : 'path planner reset failed',
    })
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'path planner reset failed',
    })
  }
})

app.post('/api/ai/agents/step-narrator/generate', async (req, res) => {
  try {
    const body = req.body as StepNarratorGenerateRequest
    const { step, context } = body
    log.log('step narrator request', {
      runId: context.runId,
      pathId: context.pathId,
      stepId: context.stepId,
      edgeId: step.edgeId,
    })
    const narrative = await agents.stepNarrator.generate(body)
    log.log('step narrator completed', {
      runId: context.runId,
      pathId: context.pathId,
      stepId: context.stepId,
    })
    res.json({ narrative })
  } catch (error) {
    log.log('step narrator failed', {
      error: error instanceof Error ? error.message : 'step narrator failed',
    })
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'step narrator failed',
    })
  }
})

app.post('/api/ai/agents/step-narrator/reset', async (_req, res) => {
  try {
    log.log('step narrator reset request')
    await agents.stepNarrator.reset()
    log.log('step narrator reset completed')
    res.json({ ok: true })
  } catch (error) {
    log.log('step narrator reset failed', {
      error: error instanceof Error ? error.message : 'step narrator reset failed',
    })
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'step narrator reset failed',
    })
  }
})

app.post('/api/ai/agents/operator-loop/decide', async (req, res) => {
  try {
    const body = req.body as OperatorLoopDecideRequest
    const requestContext = body.context
    log.log('operator loop decide request', {
      runId: requestContext.runId,
      pathId: requestContext.pathId,
      stepId: requestContext.stepId,
    })
    const decision = await agents.operatorLoop.decide(body)
    log.log('operator loop decide completed', {
      runId: requestContext.runId,
      pathId: requestContext.pathId,
      stepId: requestContext.stepId,
      result: decision.kind,
    })
    res.json(decision)
  } catch (error) {
    log.log('operator loop decide failed', {
      error: error instanceof Error ? error.message : 'operator loop decide failed',
    })
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'operator loop decide failed',
    })
  }
})

app.post('/api/ai/agents/operator-loop/append-function-responses', async (req, res) => {
  try {
    const body = req.body as OperatorLoopAppendFunctionResponsesRequest

    log.log('operator loop append function responses request', {
      runId: body.runId,
      pathId: body.pathId,
      stepId: body.stepId,
      stepOrder: body.stepOrder,
      iteration: body.runtimeState?.iteration,
      responses: body.responses.length,
    })
    await agents.operatorLoop.appendFunctionResponses(body)
    log.log('operator loop append function responses completed', {
      runId: body.runId,
      pathId: body.pathId,
      stepId: body.stepId,
    })
    res.json({ ok: true })
  } catch (error) {
    log.log('operator loop append function responses failed', {
      error: error instanceof Error ? error.message : 'append function responses failed',
    })
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'append function responses failed',
    })
  }
})

app.post('/api/ai/agents/operator-loop/cleanup-run', async (req, res) => {
  try {
    const runId = (req.body as OperatorLoopCleanupRunRequest).runId
    log.log('operator loop cleanup request', { runId })
    await agents.operatorLoop.cleanupRun(runId)
    log.log('operator loop cleanup completed', { runId })
    res.json({ ok: true })
  } catch (error) {
    log.log('operator loop cleanup failed', {
      error: error instanceof Error ? error.message : 'operator loop cleanup failed',
    })
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'operator loop cleanup failed',
    })
  }
})

app.post('/api/ai/agents/operator-loop/reset', async (_req, res) => {
  try {
    log.log('operator loop reset request')
    await agents.operatorLoop.reset()
    log.log('operator loop reset completed')
    res.json({ ok: true })
  } catch (error) {
    log.log('operator loop reset failed', {
      error: error instanceof Error ? error.message : 'operator loop reset failed',
    })
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'operator loop reset failed',
    })
  }
})

const port = Number(process.env.AI_SERVER_PORT ?? 7081)
app.listen(port, () => {
  log.log('AI server listening', {
    port,
    provider: providerId,
  })
})
