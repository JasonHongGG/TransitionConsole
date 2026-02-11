import { useMemo, useEffect, useRef, useState } from 'react'
import { curveCatmullRom, line, select, zoom, type ZoomBehavior, zoomIdentity } from 'd3'
import type { CoverageState, Diagram, DiagramConnector } from '../types'
import { layoutDiagram } from '../utils/layout'

interface SystemViewProps {
  diagrams: Diagram[]
  connectors: DiagramConnector[]
  coverage: CoverageState
  currentStateId: string | null
}

const CELL_WIDTH = 520
const CELL_HEIGHT = 320
const GRID_GAP = 28

export const SystemView = ({ diagrams, connectors, coverage, currentStateId }: SystemViewProps) => {
  const layouts = useMemo(
    () =>
      diagrams.map((diagram) => ({
        diagram,
        layout: layoutDiagram(diagram),
      })),
    [diagrams],
  )

  const svgRef = useRef<SVGSVGElement>(null)

  // State to track d3-zoom transform, initialized to Identity for exact initial layout match
  const [transform, setTransform] = useState(zoomIdentity)

  const edgeLine = useMemo(
    () =>
      line<{ x: number; y: number }>()
        .x((d) => d.x)
        .y((d) => d.y)
        .curve(curveCatmullRom.alpha(0.7)),
    [],
  )

  const columns = 2
  const rows = Math.ceil(layouts.length / columns)
  const width = columns * CELL_WIDTH + (columns - 1) * GRID_GAP
  const height = rows * CELL_HEIGHT + (rows - 1) * GRID_GAP

  // Use the calculated width/height for the base viewBox to ensure static layout
  const viewBox = `0 0 ${width} ${height}`

  const centers = layouts.reduce<Record<string, { x: number; y: number }>>((acc, entry, index) => {
    const col = index % columns
    const row = Math.floor(index / columns)
    const centerX = col * (CELL_WIDTH + GRID_GAP) + CELL_WIDTH / 2
    const centerY = row * (CELL_HEIGHT + GRID_GAP) + CELL_HEIGHT / 2
    acc[entry.diagram.id] = { x: centerX, y: centerY }
    return acc
  }, {})

  useEffect(() => {
    if (!svgRef.current) return

    const svg = select(svgRef.current)

    const zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 8]) // Increased max zoom to 8x to allow reaching "normal" size
      .on('zoom', (event) => {
        setTransform(event.transform)
      })

    svg.call(zoomBehavior)

    return () => {
      svg.on('.zoom', null)
    }
  }, [width, height]) // Re-bind if dimensions change

  // Hide labels when zoomed out.
  // In System View, diagrams are already small (mini).
  // We only show labels when the user has zoomed in significantly.
  // Since mini diagrams are ~0.3-0.4x scale, we need ~2.5x - 3x zoom to reach "normal" size.
  // Setting threshold to 2.5x ensures labels only appear when they are readable.
  const showLabels = transform.k > 2.5

  return (
    <div className="diagram-canvas system-canvas" style={{ overflow: 'hidden' }}>
      <svg
        ref={svgRef}
        className="diagram-svg"
        viewBox={viewBox}
        role="img"
        style={{ cursor: 'grab' }}
      >
        <defs>
          <marker
            id="arrow-system"
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

        {/* Apply zoom transform to the entire content group */}
        <g transform={transform.toString()} style={{ transition: 'transform 0.05s linear' }}>
          <g className="system-connectors">
            {connectors.map((connector) => {
              const from = centers[connector.from.diagramId]
              const to = centers[connector.to.diagramId]
              if (!from || !to) {
                return null
              }
              const path = edgeLine([
                { x: from.x, y: from.y },
                { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - 30 },
                { x: to.x, y: to.y },
              ])
              return (
                <path
                  key={connector.id}
                  d={path ?? ''}
                  className={`edge-path connector ${connector.type}`}
                  markerEnd="url(#arrow-system)"
                  vectorEffect="non-scaling-stroke"
                />
              )
            })}
          </g>

          {layouts.map((entry, index) => {
            const { diagram, layout } = entry
            const col = index % columns
            const row = Math.floor(index / columns)
            const offsetX = col * (CELL_WIDTH + GRID_GAP)
            const offsetY = row * (CELL_HEIGHT + GRID_GAP)
            const scale = Math.min(
              (CELL_WIDTH - 120) / layout.width,
              (CELL_HEIGHT - 120) / layout.height,
              1,
            )
            const translateX = offsetX + 60
            const translateY = offsetY + 80

            return (
              <g key={diagram.id}>
                <rect
                  className="diagram-frame"
                  x={offsetX}
                  y={offsetY}
                  width={CELL_WIDTH}
                  height={CELL_HEIGHT}
                  rx={18}
                  ry={18}
                />
                <text x={offsetX + 24} y={offsetY + 32} className="diagram-title">
                  {diagram.name}
                </text>

                <g
                  transform={`translate(${translateX}, ${translateY}) scale(${scale}) translate(${-layout.bounds.minX
                    }, ${-layout.bounds.minY})`}
                >
                  <g className="diagram-edges">
                    {layout.edges.map((edge) => {
                      const path = edgeLine(edge.points) ?? ''
                      const midPoint = edge.points[Math.floor(edge.points.length / 2)]
                      return (
                        <g key={edge.id}>
                          <path
                            d={path}
                            className="edge-path mini"
                            markerEnd="url(#arrow-system)"
                            vectorEffect="non-scaling-stroke"
                          />
                          {edge.label && midPoint && showLabels ? (
                            <text
                              x={midPoint.x}
                              y={midPoint.y - 10}
                              className="edge-label"
                              style={{ fontSize: 24 }}
                            >
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
                          className={`node mini ${visited ? 'visited' : ''} ${current ? 'current' : ''}`}
                        >
                          <rect width={node.width} height={node.height} rx={12} ry={12} />
                          <text x={node.width / 2} y={node.height / 2 + 4} textAnchor="middle">
                            {node.label}
                          </text>
                        </g>
                      )
                    })}
                  </g>
                </g>
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}
