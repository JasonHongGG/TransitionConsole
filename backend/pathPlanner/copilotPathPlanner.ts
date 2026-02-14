import { getCopilotPlannerPromptConfig } from './promptConfig'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { CopilotClient } from '@github/copilot-sdk'
import { createLogger } from '../common/logger'

export interface PlannedPathDraft {
  pathId?: string
  name?: string
  semanticGoal?: string
  edgeIds: string[]
}

export interface PlannerDiagramState {
  id: string
  walked: boolean
  [key: string]: unknown
}

export interface PlannerDiagramTransition {
  id: string
  from: string
  to: string
  walked: boolean
  [key: string]: unknown
}

export interface PlannerDiagramPayload {
  id: string
  name: string
  level: string
  parentDiagramId: string | null
  roles: string[]
  variant: {
    kind: string
    baseDiagramId: string | null
    deltaDiagramIdsByRole: Record<string, string>
    appliesToRoles: string[]
  }
  states: PlannerDiagramState[]
  transitions: PlannerDiagramTransition[]
  meta: {
    pageName: string | null
    featureName: string | null
    entryStateId: string | null
    entryValidations: string[]
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface PathPlannerContext {
  maxPaths: number
  specRaw: string | null
  diagrams: PlannerDiagramPayload[]
}

export interface PathPlanner {
  generatePaths(context: PathPlannerContext): Promise<PlannedPathDraft[]>
}

interface CopilotPathEnvelope {
  paths?: Array<{
    pathId?: string
    name?: string
    pathName?: string
    semanticGoal?: string
    start?: {
      diagramId?: string
      stateId?: string
    }
    edgeIds?: string[]
  }>
}

const log = createLogger('copilot-path-planner')

const formatLogFileTimestamp = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  const second = String(date.getSeconds()).padStart(2, '0')
  return `${year}${month}${day}_${hour}${minute}${second}`
}

const extractJsonPayload = (rawContent: string): CopilotPathEnvelope | null => {
  const trimmed = rawContent.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1]?.trim() || trimmed
  try {
    return JSON.parse(candidate) as CopilotPathEnvelope
  } catch {
    return null
  }
}

export class CopilotPathPlanner implements PathPlanner {
  private readonly model: string
  private readonly token: string | null
  private readonly cliPath?: string
  private readonly cliUrl?: string
  private readonly sessionTimeoutMs: number
  private readonly promptConfig = getCopilotPlannerPromptConfig()
  private readonly logDir: string

  constructor() {
    this.model = process.env.COPILOT_MODEL ?? 'gpt-5'
    this.token = process.env.GITHUB_TOKEN ?? null
    this.cliPath = process.env.COPILOT_CLI_PATH || undefined
    this.cliUrl = process.env.COPILOT_CLI_URL || undefined
    const parsedTimeout = Number(process.env.COPILOT_SESSION_TIMEOUT_MS ?? 180000)
    this.sessionTimeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 180000
    this.logDir = path.resolve(process.cwd(), 'logs', 'ai-agent-responses')

    log.log('initialized', {
      model: this.model,
      endpoint: this.cliUrl ?? 'copilot-sdk',
      hasToken: Boolean(this.token),
      timeoutMs: this.sessionTimeoutMs,
    })
  }

  private async logPlannerResponse(entry: {
    request: PathPlannerContext
    promptPayload: { maxPaths: number; specRaw: string; diagrams: PlannerDiagramPayload[] }
    status: number | null
    ok: boolean
    responseJson: unknown | null
    assistantPayload: CopilotPathEnvelope | null
    parsedPathsCount: number
    note?: string
  }): Promise<void> {
    try {
      await mkdir(this.logDir, { recursive: true })
      const stamp = formatLogFileTimestamp(new Date())
      const suffix = Math.random().toString(36).slice(2, 8)
      const filePath = path.join(this.logDir, `${stamp}_${suffix}.json`)

      await writeFile(
        filePath,
        JSON.stringify(
          {
            createdAt: new Date().toISOString(),
            model: this.model,
            endpoint: this.cliUrl ?? 'copilot-sdk',
            ...entry,
          },
          null,
          2,
        ),
        'utf-8',
      )
    } catch {
      // temp logging should never break planning flow
    }
  }

  async generatePaths(context: PathPlannerContext): Promise<PlannedPathDraft[]> {
    const promptPayload = {
      maxPaths: context.maxPaths,
      specRaw: context.specRaw ?? '',
      diagrams: context.diagrams,
    }

    log.log('generatePaths requested', {
      model: this.model,
      maxPaths: context.maxPaths,
      diagrams: context.diagrams.length,
      hasSpec: Boolean(context.specRaw),
    })

    if (!this.token) {
      log.log('generatePaths skipped: missing GITHUB_TOKEN', {
        model: this.model,
      })
      await this.logPlannerResponse({
        request: context,
        promptPayload,
        status: null,
        ok: false,
        responseJson: {
          error: 'Missing GITHUB_TOKEN',
          message: 'AI planner skipped because token is not configured',
        },
        assistantPayload: null,
        parsedPathsCount: 0,
        note: 'Planner skipped: missing token',
      })
      return []
    }

    const client = new CopilotClient({
      githubToken: this.token,
      cliPath: this.cliPath,
      cliUrl: this.cliUrl,
      autoStart: false,
    })

    let sdkResponseJson: unknown | null = null
    let contentText = ''

    try {
      log.log('starting Copilot client session', {
        model: this.model,
        endpoint: this.cliUrl ?? 'copilot-sdk',
      })
      await client.start()
      const session = await client.createSession({
        model: this.model,
        systemMessage: {
          content: this.promptConfig.systemPrompt,
        },
      })

      const finalEvent = await session.sendAndWait(
        {
          prompt: `${this.promptConfig.userInstruction}\n${JSON.stringify(promptPayload)}`,
        },
        this.sessionTimeoutMs,
      )

      log.log('Copilot response received', {
        model: this.model,
        eventType: finalEvent?.type ?? null,
      })

      contentText = finalEvent?.data?.content ?? ''
      sdkResponseJson = {
        eventType: finalEvent?.type ?? null,
        content: contentText,
        timeoutMs: this.sessionTimeoutMs,
      }

      await session.destroy()
      await client.stop()
    } catch (error) {
      log.log('Copilot SDK execution failed', {
        model: this.model,
        error: error instanceof Error ? error.message : String(error),
      })
      await this.logPlannerResponse({
        request: context,
        promptPayload,
        status: null,
        ok: false,
        responseJson: {
          error: 'Copilot SDK request failed',
          message: error instanceof Error ? error.message : String(error),
        },
        assistantPayload: null,
        parsedPathsCount: 0,
        note: 'Copilot SDK execution failed',
      })

      try {
        await client.forceStop()
      } catch {
        // no-op
      }
      return []
    }

    const parsed = extractJsonPayload(contentText)
    const drafts = parsed?.paths ?? []

    const validPaths = drafts
      .map((draft) => ({
        pathId: draft.pathId?.trim() || undefined,
        name: draft.pathName?.trim() || draft.name?.trim() || undefined,
        semanticGoal: draft.semanticGoal?.trim() || undefined,
        edgeIds: (draft.edgeIds ?? []).filter((id): id is string => typeof id === 'string' && id.length > 0),
      }))
      .filter((draft) => draft.edgeIds.length > 0)

    log.log('paths parsed from Copilot response', {
      model: this.model,
      parsedPaths: validPaths.length,
      requestedMaxPaths: context.maxPaths,
    })

    await this.logPlannerResponse({
      request: context,
      promptPayload,
      status: 200,
      ok: true,
      responseJson: sdkResponseJson,
      assistantPayload: parsed,
      parsedPathsCount: validPaths.length,
      note: undefined,
    })

    return validPaths.slice(0, context.maxPaths)
  }
}
