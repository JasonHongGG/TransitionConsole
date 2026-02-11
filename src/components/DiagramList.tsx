import type { Diagram } from '../types'

interface DiagramListProps {
  diagrams: Diagram[]
  selectedId: string
  onSelect: (id: string) => void
}

export const DiagramList = ({ diagrams, selectedId, onSelect }: DiagramListProps) => (
  <div className="panel">
    <div className="diagram-list">
      {diagrams.map((diagram) => (
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
  </div>
)
