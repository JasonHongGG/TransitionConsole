import type { Diagram } from '../types'

interface DiagramListProps {
  diagrams: Diagram[]
  selectedId: string
  onSelect: (id: string) => void
}

const sortDiagramsByVariant = (diagrams: Diagram[]): Diagram[] => {
  const byBaseId = new Map<string, Diagram[]>()
  const detachedDeltas: Diagram[] = []

  diagrams.forEach((diagram) => {
    if (diagram.variant.kind !== 'delta' || !diagram.variant.baseDiagramId) return
    const bucket = byBaseId.get(diagram.variant.baseDiagramId)
    if (bucket) {
      bucket.push(diagram)
    } else {
      byBaseId.set(diagram.variant.baseDiagramId, [diagram])
    }
  })

  const ordered: Diagram[] = []
  const seen = new Set<string>()

  diagrams.forEach((diagram) => {
    if (diagram.variant.kind === 'delta') return
    ordered.push(diagram)
    seen.add(diagram.id)

    const deltas = byBaseId.get(diagram.id) ?? []
    deltas.forEach((delta) => {
      ordered.push(delta)
      seen.add(delta.id)
    })
  })

  diagrams.forEach((diagram) => {
    if (!seen.has(diagram.id)) {
      detachedDeltas.push(diagram)
    }
  })

  return [...ordered, ...detachedDeltas]
}

export const DiagramList = ({ diagrams, selectedId, onSelect }: DiagramListProps) => {
  const sortedDiagrams = sortDiagramsByVariant(diagrams)

  return (
    <div className="diagram-list">
      {sortedDiagrams.map((diagram) => (
        <button
          key={diagram.id}
          type="button"
          className={`diagram-item ${selectedId === diagram.id ? 'active' : ''}`}
          onClick={() => onSelect(diagram.id)}
        >
          <span>{diagram.name}</span>
          <small>{diagram.level.toUpperCase()}</small>
        </button>
      ))}
    </div>
  )
}
