import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { CopilotAgent, type AgentStreamEvent } from './agent'

const app = express()
app.use(cors())
app.use(express.json({ limit: '2mb' }))

const port = Number(process.env.PORT ?? 7070)

const streamClients = new Set<express.Response>()

const broadcast = (event: AgentStreamEvent) => {
  const payload = `event: agent\ndata: ${JSON.stringify(event)}\n\n`
  streamClients.forEach((res) => res.write(payload))
}

const agent = new CopilotAgent(
  {
    githubToken: process.env.GITHUB_TOKEN ?? process.env.COPILOT_GITHUB_TOKEN,
    cliPath: process.env.COPILOT_CLI_PATH,
    cliUrl: process.env.COPILOT_CLI_URL,
    logLevel: process.env.COPILOT_LOG_LEVEL,
    model: process.env.COPILOT_MODEL ?? 'gpt-5',
    systemPrompt: process.env.COPILOT_SYSTEM_PROMPT,
    bootPrompt: process.env.COPILOT_BOOT_PROMPT,
    stepPrompt: process.env.COPILOT_STEP_PROMPT,
  },
  broadcast,
)

app.get('/api/agent/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  res.write('event: ready\ndata: {}\n\n')
  streamClients.add(res)

  req.on('close', () => {
    streamClients.delete(res)
  })
})

app.get('/api/agent/status', (_req, res) => {
  res.json(agent.getStatus())
})

app.post('/api/agent/start', async (req, res) => {
  try {
    await agent.startSession(req.body?.prompt)
    res.json({ ok: true })
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' })
  }
})

app.post('/api/agent/step', async (req, res) => {
  try {
    await agent.step(req.body?.prompt)
    res.json({ ok: true })
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' })
  }
})

app.post('/api/agent/stop', async (_req, res) => {
  try {
    await agent.stopSession()
    res.json({ ok: true })
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' })
  }
})

app.listen(port, () => {
  console.log(`Copilot agent server listening on ${port}`)
})
