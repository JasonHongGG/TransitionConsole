import { CopilotClient } from '@github/copilot-sdk'
import type { AiRuntime, AiRuntimeRequest, AiRuntimeFactoryOptions } from '../types'

export class CopilotSdkRuntime implements AiRuntime {
  private readonly token: string
  private readonly cliPath?: string
  private readonly cliUrl?: string

  constructor(options: AiRuntimeFactoryOptions) {
    if (!options.githubToken) {
      throw new Error('GITHUB_TOKEN is required for copilot-sdk runtime')
    }
    this.token = options.githubToken
    this.cliPath = options.cliPath
    this.cliUrl = options.cliUrl
  }

  async generate(request: AiRuntimeRequest): Promise<string> {
    const client = new CopilotClient({
      githubToken: this.token,
      cliPath: this.cliPath,
      cliUrl: this.cliUrl,
      autoStart: false,
    })

    try {
      await client.start()
      const session = await client.createSession({
        model: request.model,
        systemMessage: {
          content: request.systemPrompt,
        },
      })

      const finalEvent = await session.sendAndWait(
        {
          prompt: request.prompt,
        },
        request.timeoutMs,
      )

      await session.destroy()
      await client.stop()

      return finalEvent?.data?.content ?? ''
    } catch (error) {
      try {
        await client.forceStop()
      } catch {
        // ignore
      }
      throw error
    }
  }
}
