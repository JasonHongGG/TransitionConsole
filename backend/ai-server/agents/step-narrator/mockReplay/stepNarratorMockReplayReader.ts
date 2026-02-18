import type { StepValidationSpec, StepNarrativeInstruction } from '../../../../main-server/planned-runner/types'
import { loadSortedMockJsonFiles } from '../../common/mockReplayFileLoader'

type ParsedNarrativeShape = {
  summary?: string
  taskDescription?: string
  validations?: Array<{
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

const allowedTypes = new Set<StepValidationSpec['type']>([
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

  const validations = (input.validations ?? [])
    .map((validation, index) => {
      const description = validation.description?.trim() ?? ''
      if (!description) return null

      const normalizedType = (validation.type?.trim() || 'semantic-check') as StepValidationSpec['type']
      return {
        id: validation.id?.trim() || `validation.${index + 1}`,
        type: allowedTypes.has(normalizedType) ? normalizedType : 'semantic-check',
        description,
        expected: validation.expected?.trim() || undefined,
        selector: validation.selector?.trim() || undefined,
        timeoutMs: validation.timeoutMs && validation.timeoutMs > 0 ? validation.timeoutMs : undefined,
      }
    })
    .filter((validation) => Boolean(validation)) as StepValidationSpec[]

  return {
    summary,
    taskDescription,
    validations,
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