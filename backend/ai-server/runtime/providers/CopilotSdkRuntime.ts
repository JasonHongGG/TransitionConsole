import { CopilotClient } from '@github/copilot-sdk'
import type { AiRuntime, AiRuntimeRequest, AiRuntimeFactoryOptions } from '../types'
import { createLogger } from '../../../common/logger'

const log = createLogger('ai-runtime:copilot-sdk')

const profilingEnabled = (): boolean => {
  const value = (process.env.AI_RUNTIME_PROFILE ?? '').trim().toLowerCase()
  return value === 'true' || value === '1' || value === 'yes'
}

const elapsedMs = (startedAt: number): number => Date.now() - startedAt

export class CopilotSdkRuntime implements AiRuntime {
  private readonly token: string
  private readonly cliPath?: string
  private readonly cliUrl?: string
  private readonly client: CopilotClient
  private started = false
  private startPromise: Promise<void> | null = null

  constructor(options: AiRuntimeFactoryOptions) {
    if (!options.githubToken) {
      throw new Error('GITHUB_TOKEN is required for copilot-sdk runtime')
    }
    this.token = options.githubToken
    this.cliPath = options.cliPath
    this.cliUrl = options.cliUrl

    this.client = new CopilotClient({
      githubToken: this.token,
      cliPath: this.cliPath,
      cliUrl: this.cliUrl,
      autoStart: false,
    })
  }

  private async ensureStarted(): Promise<void> {
    if (this.started) return
    if (!this.startPromise) {
      this.startPromise = (async () => {
        const startedAt = Date.now()
        await this.client.start()
        this.started = true

        if (profilingEnabled()) {
          log.log('client started', {
            elapsedMs: elapsedMs(startedAt),
            cliPath: this.cliPath ? 'set' : 'unset',
            cliUrl: this.cliUrl ? 'set' : 'unset',
          })
        }
      })()
    }
    await this.startPromise
  }

  async generate(request: AiRuntimeRequest): Promise<string> {
    try {
      const profiling = profilingEnabled()
      const totalStartedAt = profiling ? Date.now() : 0

      const startStartedAt = profiling ? Date.now() : 0
      await this.ensureStarted()

      const startElapsed = profiling ? elapsedMs(startStartedAt) : undefined

      const createSessionStartedAt = profiling ? Date.now() : 0
      const session = await this.client.createSession({
        model: request.model,
        systemMessage: {
          content: request.systemPrompt,
        },
      })

      const createSessionElapsed = profiling ? elapsedMs(createSessionStartedAt) : undefined

      const sendStartedAt = profiling ? Date.now() : 0

      const finalEvent = await session.sendAndWait(
        {
          prompt: request.prompt,
        },
        request.timeoutMs,
      )

      const sendElapsed = profiling ? elapsedMs(sendStartedAt) : undefined

      const destroyStartedAt = profiling ? Date.now() : 0

      await session.destroy()

      const destroyElapsed = profiling ? elapsedMs(destroyStartedAt) : undefined

      if (profiling) {
        const profilePayload = {
          model: request.model,
          timeoutMs: request.timeoutMs,
          promptChars: request.prompt.length,
          systemPromptChars: request.systemPrompt.length,
          elapsedMs: elapsedMs(totalStartedAt),
          ensureStartedMs: startElapsed,
          createSessionMs: createSessionElapsed,
          sendAndWaitMs: sendElapsed,
          destroySessionMs: destroyElapsed,
        }
        log.log(`generate profiling ${JSON.stringify(profilePayload)}`)
      }

      return finalEvent?.data?.content ?? ''
    } catch (error) {
      try {
        await this.client.forceStop()
      } catch {
        // ignore
      }
      this.started = false
      this.startPromise = null

      if (profilingEnabled()) {
        log.log('generate failed', {
          error: error instanceof Error ? error.message : 'unknown error',
        })
      }
      throw error
    }
  }
}
