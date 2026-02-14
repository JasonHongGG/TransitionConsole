import type { Diagram, DiagramConnector } from '../types'
import { usePlannedRunner } from './usePlannedRunner'

export const useAgentRunner = (
  diagrams: Diagram[],
  connectors: DiagramConnector[],
  specRaw: string | null,
) => {
  return usePlannedRunner(diagrams, connectors, specRaw)
}
