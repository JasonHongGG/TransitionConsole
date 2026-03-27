import { VALIDATION_TYPES } from '../../../../main-server/planned-runner/types'
import type {
  PathNarrativeTransitionInstruction,
  StepValidationSpec,
  StepNarrativeInstruction,
} from '../../../../main-server/planned-runner/types'
import { loadSortedMockJsonFiles } from '../../common/mockReplayFileLoader'

type ParsedValidationShape = {
  id?: string
  type?: string
  description?: string
  expected?: string
  selector?: string
  timeoutMs?: number
}

type ParsedTransitionShape = {
  stepId?: string
  edgeId?: string
  summary?: string
  taskDescription?: string
  validations?: ParsedValidationShape[]
}

type ParsedNarrativeShape = {
  summary?: string
  taskDescription?: string
  executionStrategy?: string
  validations?: ParsedValidationShape[]
  transitions?: ParsedTransitionShape[]
}

type PathNarratorParsedResponse = {
  narrative?: ParsedNarrativeShape
}

const allowedTypes = new Set<StepValidationSpec['type']>(VALIDATION_TYPES)

const parseValidations = (items: ParsedValidationShape[] | undefined, prefix: string): StepValidationSpec[] =>
  (items ?? [])
    .map((validation, index) => {
      const description = validation.description?.trim() ?? ''
      if (!description) return null

      const normalizedType = (validation.type?.trim() || 'semantic-check') as StepValidationSpec['type']
      return {
        id: validation.id?.trim() || `${prefix}.validation.${index + 1}`,
        type: allowedTypes.has(normalizedType) ? normalizedType : 'semantic-check',
        description,
        expected: validation.expected?.trim() || undefined,
        selector: validation.selector?.trim() || undefined,
        timeoutMs: validation.timeoutMs && validation.timeoutMs > 0 ? validation.timeoutMs : undefined,
      }
    })
    .filter((validation) => Boolean(validation)) as StepValidationSpec[]

const parseTransitions = (items: ParsedTransitionShape[] | undefined): PathNarrativeTransitionInstruction[] =>
  (items ?? [])
    .map((transition, index) => {
      const stepId = transition.stepId?.trim() ?? ''
      const summary = transition.summary?.trim() ?? ''
      const taskDescription = transition.taskDescription?.trim() ?? ''
      if (!stepId || !summary || !taskDescription) {
        return null
      }

      return {
        stepId,
        edgeId: transition.edgeId?.trim() || `${stepId}.edge.${index + 1}`,
        summary,
        taskDescription,
        validations: parseValidations(transition.validations, stepId),
      }
    })
    .filter((transition) => Boolean(transition)) as PathNarrativeTransitionInstruction[]

const parseNarrative = (input: ParsedNarrativeShape | undefined): StepNarrativeInstruction | null => {
  if (!input) return null

  const summary = input.summary?.trim() ?? ''
  const taskDescription = input.taskDescription?.trim() ?? ''
  if (!summary || !taskDescription) return null

  const transitions = parseTransitions(input.transitions)
  const fallbackValidations = parseValidations(input.validations, 'path')
  const validations = transitions.length > 0 ? transitions.flatMap((transition) => transition.validations) : fallbackValidations

  return {
    summary,
    taskDescription,
    executionStrategy: input.executionStrategy?.trim() || undefined,
    validations,
    transitions: transitions.length > 0 ? transitions : undefined,
  }
}

export interface PathNarratorMockReplayItem {
  fileName: string
  filePath: string
  narrative: StepNarrativeInstruction | null
}

export const loadPathNarratorMockReplayItems = async (mockDir: string): Promise<PathNarratorMockReplayItem[]> => {
  const files = await loadSortedMockJsonFiles(mockDir)

  return files.map((file) => {
    const parsedResponse = file.raw.parsedResponse as PathNarratorParsedResponse | undefined
    const narrative = parseNarrative(parsedResponse?.narrative)

    return {
      fileName: file.fileName,
      filePath: file.filePath,
      narrative,
    }
  })
}