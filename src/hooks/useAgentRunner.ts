import type { Diagram } from '../types'
import { useCopilotRunner } from './useCopilotRunner'
import { useMockRunner } from './useMockRunner'

export const useAgentRunner = (diagrams: Diagram[], mode: 'mock' | 'copilot') => {
  const mockRunner = useMockRunner(diagrams)
  const copilotRunner = useCopilotRunner(diagrams, mode === 'copilot')
  return mode === 'copilot' ? copilotRunner : mockRunner
}
