import type { StepAssertionSpec, StepNarrativeInstruction } from '../../../../../main-server/planned-runner/types'
import { loadSortedMockJsonFiles } from '../../common/mockReplayFileLoader'

type ParsedNarrativeShape = {
  summary?: string
  taskDescription?: string
  assertions?: Array<{
    id?: string
    type?: string
    description?: string
    expected?: string
    selector?: string
    timeoutMs?: number
  }>
}

type StepNarratorParsedResponse = {
  narrative?: ParsedNarrativeShape
}

const allowedTypes = new Set<StepAssertionSpec['type']>([
  'url-equals',
  'url-includes',
  'text-visible',
  'text-not-visible',
  'element-visible',
  'element-not-visible',
  'network-success',
  'network-failed',
  'semantic-check',
])

const parseNarrative = (input: ParsedNarrativeShape | undefined): StepNarrativeInstruction | null => {
  if (!input) return null

  const summary = input.summary?.trim() ?? ''
  const taskDescription = input.taskDescription?.trim() ?? ''
  if (!summary || !taskDescription) return null

  const assertions = (input.assertions ?? [])
    .map((assertion, index) => {
      const description = assertion.description?.trim() ?? ''
      if (!description) return null

      const normalizedType = (assertion.type?.trim() || 'semantic-check') as StepAssertionSpec['type']
      return {
        id: assertion.id?.trim() || `assertion.${index + 1}`,
        type: allowedTypes.has(normalizedType) ? normalizedType : 'semantic-check',
        description,
        expected: assertion.expected?.trim() || undefined,
        selector: assertion.selector?.trim() || undefined,
        timeoutMs: assertion.timeoutMs && assertion.timeoutMs > 0 ? assertion.timeoutMs : undefined,
      }
    })
    .filter((assertion): assertion is StepNarrativeInstruction['assertions'][number] => Boolean(assertion))

  return {
    summary,
    taskDescription,
    assertions,
  }
}

export interface StepNarratorMockReplayItem {
  fileName: string
  filePath: string
  narrative: StepNarrativeInstruction | null
}

export const loadStepNarratorMockReplayItems = async (mockDir: string): Promise<StepNarratorMockReplayItem[]> => {
  const files = await loadSortedMockJsonFiles(mockDir)

  return files.map((file) => {
    const parsedResponse = file.raw.parsedResponse as StepNarratorParsedResponse | undefined
    const narrative = parseNarrative(parsedResponse?.narrative)

    return {
      fileName: file.fileName,
      filePath: file.filePath,
      narrative,
    }
  })
}