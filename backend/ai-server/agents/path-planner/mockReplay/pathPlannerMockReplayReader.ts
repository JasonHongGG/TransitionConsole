import type { PlannedPathDraft } from '../../../../main-server/planned-runner/planner/types'
import { loadSortedMockJsonFiles } from '../../common/mockReplayFileLoader'

type ParsedResponseShape = {
  paths?: Array<{
    pathId?: string
    name?: string
    pathName?: string
    semanticGoal?: string
    edgeIds?: string[]
  }>
}

export interface PathPlannerMockReplayItem {
  fileName: string
  filePath: string
  createdAt: string | null
  drafts: PlannedPathDraft[]
  parsedPathsCount: number
}

const parseDrafts = (drafts: ParsedResponseShape['paths']): PlannedPathDraft[] => {
  const source = drafts ?? []
  return source
    .map((draft) => ({
      pathId: draft.pathId?.trim() || undefined,
      name: draft.pathName?.trim() || draft.name?.trim() || undefined,
      semanticGoal: draft.semanticGoal?.trim() || undefined,
      edgeIds: (draft.edgeIds ?? []).filter((id): id is string => typeof id === 'string' && id.length > 0),
    }))
    .filter((draft) => draft.edgeIds.length > 0)
}

export const loadPathPlannerMockReplayItems = async (mockDir: string): Promise<PathPlannerMockReplayItem[]> => {
  const files = await loadSortedMockJsonFiles(mockDir)

  return files.map((file) => {
    const parsedResponse = file.raw.parsedResponse as ParsedResponseShape | undefined
    const drafts = parseDrafts(parsedResponse?.paths)

    return {
      fileName: file.fileName,
      filePath: file.filePath,
      createdAt: typeof file.raw.createdAt === 'string' ? file.raw.createdAt : null,
      drafts,
      parsedPathsCount: drafts.length,
    }
  })
}