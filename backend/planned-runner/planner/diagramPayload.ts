import type { PlannerDiagramPayload, PlannerDiagramState, PlannerDiagramTransition } from './plannerProvider/types'
import type { DiagramConnector, DiagramLike, ElementExecutionStatus } from '../types'
import { isWalked } from './common'

export const buildPlannerDiagrams = (
  diagrams: DiagramLike[],
  connectorsFromApp: DiagramConnector[],
  nodeStatuses: Record<string, ElementExecutionStatus>,
  edgeStatuses: Record<string, ElementExecutionStatus>,
): PlannerDiagramPayload[] => {
  const plannerDiagrams = new Map<string, PlannerDiagramPayload>()

  diagrams.forEach((diagram) => {
    const states: PlannerDiagramState[] = (diagram.states ?? []).map((state) => ({
      ...state,
      walked: isWalked(nodeStatuses[state.id]),
    }))

    const transitions: PlannerDiagramTransition[] = (diagram.transitions ?? []).map((transition) => ({
      ...transition,
      walked: isWalked(edgeStatuses[transition.id]),
    }))

    const connectors = (diagram.connectors ?? []).map((connector) => ({
      ...connector,
      walked: connector.type === 'invokes' ? isWalked(edgeStatuses[connector.id]) : false,
    }))

    plannerDiagrams.set(diagram.id, {
      ...diagram,
      name: diagram.name,
      level: diagram.level ?? 'standalone',
      parentDiagramId: diagram.parentDiagramId ?? null,
      roles: diagram.roles ?? [],
      variant: {
        kind: diagram.variant?.kind ?? 'standalone',
        baseDiagramId: diagram.variant?.baseDiagramId ?? null,
        deltaDiagramIdsByRole: diagram.variant?.deltaDiagramIdsByRole ?? {},
        appliesToRoles: diagram.variant?.appliesToRoles ?? [],
      },
      states,
      transitions,
      connectors,
      meta: {
        pageName: (diagram.meta?.pageName as string | null | undefined) ?? diagram.name,
        featureName: (diagram.meta?.featureName as string | null | undefined) ?? null,
        entryStateId: diagram.meta?.entryStateId ?? null,
        entryValidations: diagram.meta?.entryValidations ?? [],
        ...(diagram.meta ?? {}),
      },
    })
  })

  const connectors = connectorsFromApp.length > 0 ? connectorsFromApp : diagrams.flatMap((diagram) => diagram.connectors ?? [])
  connectors
    .filter((connector) => connector.type === 'invokes' && connector.from.stateId && connector.to.stateId)
    .forEach((connector) => {
      const diagram = plannerDiagrams.get(connector.from.diagramId)
      if (!diagram) return

      const diagramWithConnectors = diagram as unknown as {
        connectors?: Array<Record<string, unknown> & { id?: string }>
      }

      const currentConnectors = Array.isArray(diagramWithConnectors.connectors)
        ? diagramWithConnectors.connectors.filter((item): item is { id?: string } => typeof item === 'object' && item !== null)
        : []

      if (!currentConnectors.some((item) => item.id === connector.id)) {
        diagramWithConnectors.connectors = [
          ...currentConnectors,
          {
            ...connector,
            walked: isWalked(edgeStatuses[connector.id]),
          },
        ]
      }

      diagram.transitions.push({
        id: connector.id,
        from: connector.from.stateId as string,
        to: connector.to.stateId as string,
        event: connector.meta?.reason ?? connector.meta?.action ?? connector.id,
        kind: 'connector-invokes',
        walked: isWalked(edgeStatuses[connector.id]),
        meta: connector.meta ?? {},
      })
    })

  return Array.from(plannerDiagrams.values())
}
