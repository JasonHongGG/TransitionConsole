import { CopilotClient, type CopilotSession } from '@github/copilot-sdk'

export type AgentEventLevel = 'info' | 'success' | 'error'
export type CopilotLogLevel = 'info' | 'error' | 'none' | 'warning' | 'debug' | 'all'

export interface AgentStreamEvent {
  type: string
  timestamp: string
  level: AgentEventLevel
  message: string
  role?: string
  stateId?: string
  transitionId?: string
  result?: 'pass' | 'fail'
}

export interface CopilotAgentOptions {
  githubToken?: string
  cliPath?: string
  cliUrl?: string
  logLevel?: CopilotLogLevel
  model: string
  systemPrompt?: string
  bootPrompt?: string
  stepPrompt?: string
}

const nowIso = () => new Date().toISOString()

const getEventContent = (data: unknown): string | null => {
  if (!data || typeof data !== 'object') {
    return null
  }
  if ('content' in data && typeof (data as { content?: unknown }).content === 'string') {
    return (data as { content: string }).content
  }
  if ('deltaContent' in data && typeof (data as { deltaContent?: unknown }).deltaContent === 'string') {
    return (data as { deltaContent: string }).deltaContent
  }
  return null
}

const parseAgentPayload = (content: string): Partial<AgentStreamEvent> | null => {
  const trimmed = content.trim()
  if (!trimmed.startsWith('{')) {
    return null
  }
  try {
    const payload = JSON.parse(trimmed) as Partial<AgentStreamEvent>
    if (payload && typeof payload.message === 'string') {
      return payload
    }
    return null
  } catch {
    return null
  }
}

export class CopilotAgent {
  private client: CopilotClient | null = null
  private session: CopilotSession | null = null
  private sessionUnsubscribe: (() => void) | null = null

  constructor(
    private options: CopilotAgentOptions,
    private emit: (event: AgentStreamEvent) => void,
  ) {}

  private async ensureClient() {
    if (this.client) {
      return
    }
    this.client = new CopilotClient({
      githubToken: this.options.githubToken,
      cliPath: this.options.cliPath,
      cliUrl: this.options.cliUrl,
      logLevel: this.options.logLevel ?? 'info',
    })
    await this.client.start()
  }

  private wireSession(session: CopilotSession) {
    this.sessionUnsubscribe?.()
    this.sessionUnsubscribe = session.on((event) => {
      const content = getEventContent(event.data)

      if (event.type === 'assistant.message' && typeof content === 'string') {
        const payload = parseAgentPayload(content)
        if (payload) {
          this.emit({
            type: payload.type ?? event.type,
            timestamp: payload.timestamp ?? nowIso(),
            level: payload.level ?? 'info',
            message: payload.message ?? 'Assistant update',
            role: payload.role,
            stateId: payload.stateId,
            transitionId: payload.transitionId,
            result: payload.result,
          })
          return
        }
      }

      const message = typeof content === 'string' ? content : `Event: ${event.type}`

      this.emit({
        type: event.type,
        timestamp: nowIso(),
        level: event.type.includes('error') ? 'error' : 'info',
        message,
      })
    })
  }

  async startSession(prompt?: string) {
    await this.ensureClient()
    if (!this.client) {
      throw new Error('Copilot client not available')
    }

    if (!this.session) {
      this.session = await this.client.createSession({
        model: this.options.model,
        systemMessage: this.options.systemPrompt
          ? { content: this.options.systemPrompt }
          : undefined,
        streaming: true,
      })
      this.wireSession(this.session)
      this.emit({
        type: 'session.started',
        timestamp: nowIso(),
        level: 'info',
        message: 'Copilot session started',
      })
    }

    const initialPrompt = prompt ?? this.options.bootPrompt
    if (initialPrompt) {
      await this.session.send({ prompt: initialPrompt })
    }
  }

  async step(prompt?: string) {
    if (!this.session) {
      throw new Error('No active session')
    }
    const nextPrompt = prompt ?? this.options.stepPrompt ?? 'Continue with the next test step.'
    await this.session.send({ prompt: nextPrompt })
  }

  async stopSession() {
    if (this.session) {
      await this.session.destroy()
      this.session = null
    }
    this.sessionUnsubscribe?.()
    this.sessionUnsubscribe = null

    if (this.client) {
      await this.client.stop()
      this.client = null
    }

    this.emit({
      type: 'session.stopped',
      timestamp: nowIso(),
      level: 'info',
      message: 'Copilot session stopped',
    })
  }

  getStatus() {
    return {
      running: Boolean(this.session),
      model: this.options.model,
    }
  }
}
