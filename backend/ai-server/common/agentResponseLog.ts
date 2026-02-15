import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

type AgentResponseLogOptions = {
  agent: 'path-planner' | 'step-narrator' | 'operator-loop'
  model?: string
  runId?: string
  pathId?: string
  stepId?: string
  request?: unknown
  rawResponse?: string
  parsedResponse?: unknown
  mode?: 'llm' | 'mock-replay'
}

const timestampForFile = (): string => {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  const second = String(date.getSeconds()).padStart(2, '0')
  return `${year}${month}${day}_${hour}${minute}${second}`
}

const randomSuffix = (): string => Math.random().toString(36).slice(2, 8)

export const writeAgentResponseLog = async (options: AgentResponseLogOptions): Promise<string> => {
  const baseDir = path.resolve(process.cwd(), 'logs', 'ai-agent-responses', options.agent)
  await mkdir(baseDir, { recursive: true })

  const fileName = `${timestampForFile()}_${randomSuffix()}.json`
  const filePath = path.join(baseDir, fileName)

  const payload = {
    agent: options.agent,
    mode: options.mode ?? 'llm',
    model: options.model ?? null,
    runId: options.runId ?? null,
    pathId: options.pathId ?? null,
    stepId: options.stepId ?? null,
    createdAt: new Date().toISOString(),
    request: options.request ?? null,
    rawResponse: options.rawResponse ?? null,
    parsedResponse: options.parsedResponse ?? null,
  }

  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
  return filePath
}
