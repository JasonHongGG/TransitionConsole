import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { PlannedPathDraft } from './types'

interface CopilotPathEnvelope {
  paths?: Array<{
    pathId?: string
    name?: string
    pathName?: string
    semanticGoal?: string
    edgeIds?: string[]
  }>
}

export interface MockReplayItem {
  fileName: string
  filePath: string
  createdAt: string | null
  drafts: PlannedPathDraft[]
  parsedPathsCount: number
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

const parseDrafts = (envelope: CopilotPathEnvelope | null): PlannedPathDraft[] => {
  const drafts = envelope?.paths ?? []
  return drafts
    .map((draft) => ({
      pathId: draft.pathId?.trim() || undefined,
      name: draft.pathName?.trim() || draft.name?.trim() || undefined,
      semanticGoal: draft.semanticGoal?.trim() || undefined,
      edgeIds: (draft.edgeIds ?? []).filter((id): id is string => typeof id === 'string' && id.length > 0),
    }))
    .filter((draft) => draft.edgeIds.length > 0)
}

const parseTimestampFromFileName = (fileName: string): number | null => {
  const match = fileName.match(/(\d{8})_(\d{6})/)
  if (!match) return null

  const [year, month, day] = [match[1].slice(0, 4), match[1].slice(4, 6), match[1].slice(6, 8)]
  const [hour, minute, second] = [match[2].slice(0, 2), match[2].slice(2, 4), match[2].slice(4, 6)]
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}`
  const date = new Date(iso)
  const value = date.getTime()
  return Number.isFinite(value) ? value : null
}

const parseCreatedAt = (value: unknown): number | null => {
  if (typeof value !== 'string' || value.length === 0) return null
  const date = new Date(value)
  const timestamp = date.getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

export const loadMockReplayItems = async (mockDir: string): Promise<MockReplayItem[]> => {
  const directoryEntries = await readdir(mockDir, { withFileTypes: true })
  const files = directoryEntries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .map((entry) => entry.name)

  const loaded = await Promise.all(
    files.map(async (fileName) => {
      const filePath = path.join(mockDir, fileName)
      const content = await readFile(filePath, 'utf-8')
      const raw = JSON.parse(content) as Record<string, unknown>

      const assistantPayload = raw.assistantPayload as CopilotPathEnvelope | undefined
      const responseJson = raw.responseJson as { content?: string } | undefined
      const parsedFromResponse = typeof responseJson?.content === 'string' ? extractJsonPayload(responseJson.content) : null
      const fallbackEnvelope = Array.isArray(raw.paths) ? ({ paths: raw.paths } as CopilotPathEnvelope) : null
      const envelope = assistantPayload ?? parsedFromResponse ?? fallbackEnvelope
      const drafts = parseDrafts(envelope)

      return {
        fileName,
        filePath,
        createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : null,
        drafts,
        parsedPathsCount: drafts.length,
        sortFileTimestamp: parseTimestampFromFileName(fileName),
        sortCreatedAt: parseCreatedAt(raw.createdAt),
      }
    }),
  )

  return loaded
    .sort((a, b) => {
      const aPrimary = a.sortFileTimestamp ?? a.sortCreatedAt ?? Number.MAX_SAFE_INTEGER
      const bPrimary = b.sortFileTimestamp ?? b.sortCreatedAt ?? Number.MAX_SAFE_INTEGER
      if (aPrimary !== bPrimary) return aPrimary - bPrimary
      return a.fileName.localeCompare(b.fileName)
    })
    .map((entry) => ({
      fileName: entry.fileName,
      filePath: entry.filePath,
      createdAt: entry.createdAt,
      drafts: entry.drafts,
      parsedPathsCount: entry.parsedPathsCount,
    }))
}
