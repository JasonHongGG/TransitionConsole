import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { createLogger } from '../common/logger'
import type { ExecutorContext, PlannedTransitionStep } from '../main-server/planned-runner/types'
import type {
  InstructionPlannerBuildRequest,
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
      res.status(400).json({ ok: false, error: 'context is required' })
      return
    }
    const paths = await agents.pathPlanner.generate(context)
    res.json({ paths })
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'path planner failed',
    })
  }
})

app.post('/api/ai/path-planner/reset', async (_req, res) => {
  try {
    await agents.pathPlanner.reset()
    res.json({ ok: true })
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'path planner reset failed',
    })
  }
})

app.post('/api/ai/agents/step-narrator/generate', async (req, res) => {
  try {
    const body = req.body as StepNarratorGenerateRequest
    const step = body.step as PlannedTransitionStep
    const context = body.context as ExecutorContext
    const narrative = await agents.stepNarrator.generate(step, context)
    res.json({ narrative })
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'step narrator failed',
    })
  }
})

app.post('/api/ai/agents/instruction-planner/build', async (req, res) => {
  try {
    const body = req.body as InstructionPlannerBuildRequest
    const step = body.step as PlannedTransitionStep
    const context = body.context as ExecutorContext
    const output = await agents.instructionPlanner.build(step, context)
    res.json(output)
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'instruction planner failed',
    })
  }
})

app.post('/api/ai/agents/operator-loop/decide', async (req, res) => {
  try {
    const decision = await agents.operatorLoop.decide(req.body as OperatorLoopDecideRequest)
    res.json(decision)
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'operator loop decide failed',
    })
  }
})

app.post('/api/ai/agents/operator-loop/append-function-responses', async (req, res) => {
  try {
    const body = req.body as OperatorLoopAppendFunctionResponsesRequest
    const runId = body.runId
    const pathId = body.pathId
    const responses = body.responses

    await agents.operatorLoop.appendFunctionResponses(runId, pathId, responses)
    res.json({ ok: true })
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'append function responses failed',
    })
  }
})

app.post('/api/ai/agents/operator-loop/cleanup-run', async (req, res) => {
  try {
    const runId = (req.body as OperatorLoopCleanupRunRequest).runId
    await agents.operatorLoop.cleanupRun(runId)
    res.json({ ok: true })
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'operator loop cleanup failed',
    })
  }
})

const port = Number(process.env.AI_SERVER_PORT ?? 7081)
app.listen(port, () => {
  log.log(`AI server listening on ${port}`, {
    provider: providerId,
  })
})
