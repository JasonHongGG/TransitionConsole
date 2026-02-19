export interface AiRuntimeRequest {
  model: string
  systemPrompt: string
  prompt: string
  attachments?: AiRuntimeMessageAttachment[]
  timeoutMs: number
}

export type AiRuntimeMessageAttachment =
  | {
      type: 'file'
      path: string
      displayName?: string
    }
  | {
      type: 'directory'
      path: string
      displayName?: string
    }
  | {
      type: 'selection'
      filePath: string
      displayName: string
      selection?: {
        start: { line: number; character: number }
        end: { line: number; character: number }
      }
      text?: string
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
