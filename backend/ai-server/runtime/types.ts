export interface AiRuntimeRequest {
  model: string
  systemPrompt: string
  prompt: string
  timeoutMs: number
}

export interface AiRuntime {
  generate(request: AiRuntimeRequest): Promise<string>
}

export interface AiRuntimeFactoryOptions {
  provider: string
  githubToken?: string
  cliPath?: string
  cliUrl?: string
}
