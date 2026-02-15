import type { StepAssertionSpec, StepInstruction } from '../../types'
import type { CopilotInstructionEnvelope } from '../contracts'

export const extractJsonPayload = (rawContent: string): CopilotInstructionEnvelope | null => {
  const trimmed = rawContent.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1]?.trim() || trimmed
  try {
    return JSON.parse(candidate) as CopilotInstructionEnvelope
  } catch {
    return null
  }
}

export const normalizeAssertionType = (value: string | undefined): StepAssertionSpec['type'] => {
  const supported: StepAssertionSpec['type'][] = [
    'url-equals',
    'url-includes',
    'text-visible',
    'text-not-visible',
    'element-visible',
    'element-not-visible',
    'network-success',
    'network-failed',
    'semantic-check',
  ]
  if (!value) return 'semantic-check'
  const normalized = value.trim() as StepAssertionSpec['type']
  return supported.includes(normalized) ? normalized : 'semantic-check'
}

export const normalizeActionType = (value: string | undefined): StepInstruction['actions'][number]['action'] => {
  const supported: StepInstruction['actions'][number]['action'][] = [
    'goto',
    'click',
    'type',
    'press',
    'select',
    'wait',
    'scroll',
    'custom',
  ]
  if (!value) return 'custom'
  const normalized = value.trim() as StepInstruction['actions'][number]['action']
  return supported.includes(normalized) ? normalized : 'custom'
}
