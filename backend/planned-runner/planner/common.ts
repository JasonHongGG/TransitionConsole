import type { DiagramLike, ElementExecutionStatus } from '../types'

export const isWalked = (status: ElementExecutionStatus | undefined): boolean =>
  status === 'running' || status === 'pass' || status === 'fail'

export const resolveGlobalEntryStateId = (sourceDiagrams: DiagramLike[], fallbackEntryStateIds: string[]): string | null => {
  const pageEntryDiagram = sourceDiagrams.find((diagram) => diagram.id === 'page_entry')
  if (pageEntryDiagram?.meta?.entryStateId) return pageEntryDiagram.meta.entryStateId

  const initState = pageEntryDiagram?.states?.find((state) => {
    const stateId = state.id.toLowerCase()
    return stateId === 'init' || stateId.endsWith('.init')
  })
  if (initState) return initState.id

  return fallbackEntryStateIds[0] ?? null
}
