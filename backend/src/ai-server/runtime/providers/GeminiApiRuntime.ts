import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type {
  AiRuntime,
  AiRuntimeFactoryOptions,
  AiRuntimeMessageAttachment,
  AiRuntimeRequest,
} from '../types'
import { createLogger } from '../../../common/logger'

const log = createLogger('ai-runtime:gemini')

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }

interface GeminiCandidate {
  content?: {
    parts?: Array<{
      text?: string
    }>
  }
  finishReason?: string
  finishMessage?: string
}

interface GeminiGenerateContentResponse {
  candidates?: GeminiCandidate[]
  promptFeedback?: {
    blockReason?: string
  }
}

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

const TEXT_MIME_TYPES = new Set([
  'application/json',
  'application/javascript',
  'application/typescript',
  'application/xml',
])

const profilingEnabled = (): boolean => {
  const value = (process.env.AI_RUNTIME_PROFILE ?? '').trim().toLowerCase()
  return value === 'true' || value === '1' || value === 'yes'
}

const elapsedMs = (startedAt: number): number => Date.now() - startedAt

const normalizeBaseUrl = (value?: string): string => {
  const baseUrl = (value ?? DEFAULT_BASE_URL).trim()
  return baseUrl.replace(/\/+$/, '')
}

const inferMimeType = (filePath: string): string => {
  const extension = extname(filePath).trim().toLowerCase()

  switch (extension) {
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.heic':
      return 'image/heic'
    case '.heif':
      return 'image/heif'
    case '.txt':
    case '.md':
    case '.log':
      return 'text/plain'
    case '.json':
      return 'application/json'
    case '.ts':
    case '.tsx':
      return 'application/typescript'
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return 'application/javascript'
    case '.html':
      return 'text/html'
    case '.css':
      return 'text/css'
    case '.xml':
      return 'application/xml'
    case '.yaml':
    case '.yml':
      return 'text/yaml'
    case '.csv':
      return 'text/csv'
    default:
      return 'application/octet-stream'
  }
}

const isImageMimeType = (mimeType: string): boolean => mimeType.startsWith('image/')

const isTextMimeType = (mimeType: string): boolean => mimeType.startsWith('text/') || TEXT_MIME_TYPES.has(mimeType)

const normalizeTextContent = (value: string): string => value.replace(/\r\n/g, '\n')

const extractSelectionText = (
  source: string,
  selection?: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  },
): string => {
  if (!selection) {
    return source
  }

  const lines = normalizeTextContent(source).split('\n')
  const startLine = Math.max(0, selection.start.line)
  const endLine = Math.max(startLine, selection.end.line)

  if (startLine >= lines.length) {
    return ''
  }

  if (startLine === endLine) {
    const line = lines[startLine] ?? ''
    return line.slice(selection.start.character, selection.end.character)
  }

  const parts: string[] = []
  parts.push((lines[startLine] ?? '').slice(selection.start.character))

  for (let index = startLine + 1; index < endLine && index < lines.length; index += 1) {
    parts.push(lines[index] ?? '')
  }

  if (endLine < lines.length) {
    parts.push((lines[endLine] ?? '').slice(0, selection.end.character))
  }

  return parts.join('\n')
}

const formatAttachmentHeader = (label: string, mimeType: string): string => `Attachment: ${label} (${mimeType})`

export class GeminiApiRuntime implements AiRuntime {
  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(options: AiRuntimeFactoryOptions) {
    if (!options.geminiApiKey) {
      throw new Error('GEMINI_API_KEY is required for gemini runtime')
    }

    this.apiKey = options.geminiApiKey
    this.baseUrl = normalizeBaseUrl(options.geminiApiBaseUrl)
  }

  private buildGenerateContentUrl(model: string): string {
    const normalizedModel = model.startsWith('models/') ? model : `models/${model}`
    return `${this.baseUrl}/${normalizedModel}:generateContent?key=${encodeURIComponent(this.apiKey)}`
  }

  private async buildAttachmentParts(attachment: AiRuntimeMessageAttachment): Promise<GeminiPart[]> {
    if (attachment.type === 'directory') {
      throw new Error('Gemini runtime does not support directory attachments')
    }

    if (attachment.type === 'selection') {
      const source = attachment.text ?? await readFile(attachment.filePath, 'utf8')
      const selectedText = attachment.text ?? extractSelectionText(source, attachment.selection)
      const label = attachment.displayName || basename(attachment.filePath)

      return [{
        text: `${formatAttachmentHeader(label, 'text/plain')}\nSource: ${attachment.filePath}\n${selectedText}`,
      }]
    }

    const mimeType = inferMimeType(attachment.path)
    const label = attachment.displayName || basename(attachment.path)

    if (isImageMimeType(mimeType)) {
      const bytes = await readFile(attachment.path)
      return [
        { text: formatAttachmentHeader(label, mimeType) },
        { inlineData: { mimeType, data: bytes.toString('base64') } },
      ]
    }

    if (isTextMimeType(mimeType)) {
      const content = await readFile(attachment.path, 'utf8')
      return [{
        text: `${formatAttachmentHeader(label, mimeType)}\n${content}`,
      }]
    }

    throw new Error(`Gemini runtime does not support ${mimeType} file attachments yet`)
  }

  private async buildUserParts(request: AiRuntimeRequest): Promise<GeminiPart[]> {
    const parts: GeminiPart[] = []

    for (const attachment of request.attachments ?? []) {
      parts.push(...await this.buildAttachmentParts(attachment))
    }

    parts.push({ text: request.prompt })

    return parts
  }

  private extractText(response: GeminiGenerateContentResponse): string {
    const candidate = response.candidates?.[0]

    if (!candidate) {
      const blockReason = response.promptFeedback?.blockReason
      throw new Error(blockReason
        ? `Gemini API blocked the request: ${blockReason}`
        : 'Gemini API returned no candidates')
    }

    const text = candidate.content?.parts
      ?.map((part) => part.text ?? '')
      .join('')
      .trim() ?? ''

    if (!text) {
      const finishReason = candidate.finishReason ?? 'UNKNOWN'
      const finishMessage = candidate.finishMessage ? ` ${candidate.finishMessage}` : ''
      throw new Error(`Gemini API returned no text content (finishReason: ${finishReason}).${finishMessage}`)
    }

    return text
  }

  async generate(request: AiRuntimeRequest): Promise<string> {
    const profiling = profilingEnabled()
    const totalStartedAt = profiling ? Date.now() : 0
    const attachmentStartedAt = profiling ? Date.now() : 0
    const userParts = await this.buildUserParts(request)
    const attachmentElapsed = profiling ? elapsedMs(attachmentStartedAt) : undefined

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), request.timeoutMs)

    try {
      const requestBody = {
        systemInstruction: {
          parts: [{ text: request.systemPrompt }],
        },
        contents: [{
          role: 'user',
          parts: userParts,
        }],
      }

      const fetchStartedAt = profiling ? Date.now() : 0
      const response = await fetch(this.buildGenerateContentUrl(request.model), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      })
      const fetchElapsed = profiling ? elapsedMs(fetchStartedAt) : undefined

      if (!response.ok) {
        const errorBody = await response.text()
        let message = errorBody

        try {
          const parsed = JSON.parse(errorBody) as { error?: { message?: string } }
          message = parsed.error?.message ?? errorBody
        } catch {
          // ignore JSON parse failures
        }

        throw new Error(`Gemini API request failed (${response.status} ${response.statusText}): ${message}`)
      }

      const parseStartedAt = profiling ? Date.now() : 0
      const responseJson = await response.json() as GeminiGenerateContentResponse
      const parseElapsed = profiling ? elapsedMs(parseStartedAt) : undefined
      const text = this.extractText(responseJson)

      if (profiling) {
        log.log('generate profiling', {
          model: request.model,
          timeoutMs: request.timeoutMs,
          promptChars: request.prompt.length,
          systemPromptChars: request.systemPrompt.length,
          attachmentCount: request.attachments?.length ?? 0,
          elapsedMs: elapsedMs(totalStartedAt),
          prepareAttachmentsMs: attachmentElapsed,
          fetchMs: fetchElapsed,
          parseMs: parseElapsed,
        })
      }

      return text
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Gemini API request timed out after ${request.timeoutMs}ms`)
      }

      if (profilingEnabled()) {
        log.log('generate failed', {
          error: error instanceof Error ? error.message : 'unknown error',
        })
      }

      throw error
    } finally {
      clearTimeout(timeoutId)
    }
  }
}