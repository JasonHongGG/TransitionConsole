import type { AiRuntime, AiRuntimeFactoryOptions } from './types'
import { CopilotSdkRuntime } from './providers/CopilotSdkRuntime'
import { GeminiApiRuntime } from './providers/GeminiApiRuntime'

const runtimeCliPath = (): string | undefined => process.env.AI_RUNTIME_CLI_PATH || undefined
const runtimeCliUrl = (): string | undefined => process.env.AI_RUNTIME_CLI_URL || undefined
const runtimeGeminiApiBaseUrl = (): string | undefined => process.env.GEMINI_API_BASE_URL || undefined

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

  if (provider === 'gemini' || provider === 'gemini-api') {
    return new GeminiApiRuntime({
      provider,
      geminiApiKey: options?.geminiApiKey ?? process.env.GEMINI_API_KEY,
      geminiApiBaseUrl: options?.geminiApiBaseUrl ?? runtimeGeminiApiBaseUrl(),
    })
  }

  throw new Error(`Unsupported AI provider: ${provider}`)
}
