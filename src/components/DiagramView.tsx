import { useMemo } from 'react'
import { curveCatmullRom, line } from 'd3-shape'
import type { CoverageState, Diagram } from '../types'
import { layoutDiagram } from '../utils/layout'

interface DiagramViewProps {
  diagram: Diagram
  coverage: CoverageState
  currentStateId: string | null
}

export const DiagramView = ({ diagram, coverage, currentStateId }: DiagramViewProps) => {
  const layout = useMemo(() => layoutDiagram(diagram), [diagram])
  const edgeLine = useMemo(
    () =>
      line<{ x: number; y: number }>()
        .x((d) => d.x)
        .y((d) => d.y)
        .curve(curveCatmullRom.alpha(0.7)),
    [],
  )

  const viewBox = `${layout.bounds.minX - 80} ${layout.bounds.minY - 80} ${layout.width + 160} ${layout.height + 160}`

  return (
    <div className="diagram-canvas">
      <svg className="diagram-svg" viewBox={viewBox} role="img">
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--line)" />
          </marker>
        </defs>

        <g className="diagram-edges">
          {layout.edges.map((edge) => {
            const path = edgeLine(edge.points) ?? ''
            const midPoint = edge.points[Math.floor(edge.points.length / 2)]
            return (
              <g key={edge.id}>
                <path
                  d={path}
                  className="edge-path"
                  markerEnd="url(#arrow)"
                />
                {edge.label && midPoint ? (
                  <text x={midPoint.x} y={midPoint.y - 10} className="edge-label">
                    {edge.label}
                  </text>
                ) : null}
              </g>
            )
          })}
        </g>

        <g className="diagram-nodes">
          {layout.nodes.map((node) => {
            const visited = coverage.visitedNodes.has(node.id)
            const current = currentStateId === node.id
            return (
              <g
                key={node.id}
                transform={`translate(${node.x - node.width / 2}, ${node.y - node.height / 2})`}
                className={`node ${node.type} ${visited ? 'visited' : ''} ${current ? 'current' : ''}`}
              >
                <rect width={node.width} height={node.height} rx={12} ry={12} />
                <text x={node.width / 2} y={node.height / 2 + 4} textAnchor="middle">
                  {node.label}
                </text>
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}
