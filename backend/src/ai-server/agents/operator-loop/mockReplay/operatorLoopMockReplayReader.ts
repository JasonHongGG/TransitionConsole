import type {
  LoopDecision,
  LoopFunctionCall,
} from '../../../../operator-server/type'
import { loadSortedMockJsonFiles } from '../../common/mockReplayFileLoader'

type ParsedOperatorResponse = {
  decision?: {
    kind?: 'complete' | 'act' | 'fail'
    reason?: string
    failureCode?: LoopDecision['failureCode']
    terminationReason?: LoopDecision['terminationReason']
  }
  functionCalls?: Array<{
    name?: string
    args?: Record<string, unknown>
    description?: string
  }>
  progressSummary?: string
  validationUpdates?: Array<{
    id?: string
    status?: 'pass' | 'fail'
    reason?: string
    actual?: string
  }>
}

const parseFunctionCalls = (input: ParsedOperatorResponse['functionCalls']): LoopFunctionCall[] | undefined => {
  const normalized = (input ?? [])
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .filter((item) => Boolean(item.name && item.args && typeof item.args === 'object'))
    .map((item) => ({
      name: item.name!,
      args: item.args!,
      description: item.description,
    }))

  return normalized.length > 0 ? normalized : undefined
}

const parseDecision = (input: ParsedOperatorResponse | undefined): LoopDecision | null => {
  if (!input?.decision?.kind || !input.decision.reason || !input.progressSummary?.trim() || !Array.isArray(input.validationUpdates)) return null

  const validationUpdates = input.validationUpdates
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .filter((item) => Boolean(item.id && item.reason && (item.status === 'pass' || item.status === 'fail')))
    .map((item) => ({
      id: item.id!,
      status: item.status!,
      reason: item.reason!,
      actual: item.actual,
    }))

  if (input.decision.kind === 'act') {
    const functionCalls = parseFunctionCalls(input.functionCalls)
    if (!functionCalls || functionCalls.length === 0) return null

    return {
      kind: 'act',
      reason: input.decision.reason,
      progressSummary: input.progressSummary,
      validationUpdates,
      functionCalls,
    }
  }

  if (input.decision.kind === 'complete') {
    return {
      kind: 'complete',
      reason: input.decision.reason,
      progressSummary: input.progressSummary,
      validationUpdates,
      terminationReason: input.decision.terminationReason ?? 'completed',
    }
  }

  return {
    kind: 'fail',
    reason: input.decision.reason,
    progressSummary: input.progressSummary,
    validationUpdates,
    failureCode: input.decision.failureCode ?? 'operator-no-progress',
    terminationReason: input.decision.terminationReason ?? 'criteria-unmet',
  }
}

export interface OperatorLoopMockReplayItem {
  fileName: string
  filePath: string
  decision: LoopDecision | null
}

export const loadOperatorLoopMockReplayItems = async (mockDir: string): Promise<OperatorLoopMockReplayItem[]> => {
  const files = await loadSortedMockJsonFiles(mockDir)

  return files.map((file) => {
    const parsedResponse = file.raw.parsedResponse as ParsedOperatorResponse | undefined
    const decision = parseDecision(parsedResponse)

    return {
      fileName: file.fileName,
      filePath: file.filePath,
      decision,
    }
  })
}