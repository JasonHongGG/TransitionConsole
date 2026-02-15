import type { AiRuntime, AiRuntimeFactoryOptions } from './types'
import { CopilotSdkRuntime } from './providers/CopilotSdkRuntime'

const runtimeCliPath = (): string | undefined => process.env.AI_RUNTIME_CLI_PATH || undefined
const runtimeCliUrl = (): string | undefined => process.env.AI_RUNTIME_CLI_URL || undefined

export const createAiRuntime = (options?: Partial<AiRuntimeFactoryOptions>): AiRuntime => {
  const provider = (options?.provider ?? process.env.AI_PROVIDER ?? 'copilot-sdk').trim().toLowerCase()

  if (provider === 'copilot-sdk') {
    return new CopilotSdkRuntime({
      provider,
      githubToken: options?.githubToken ?? process.env.GITHUB_TOKEN,
      cliPath: options?.cliPath ?? runtimeCliPath(),
      cliUrl: options?.cliUrl ?? runtimeCliUrl(),
    })
  }

  throw new Error(`Unsupported AI provider: ${provider}`)
}
