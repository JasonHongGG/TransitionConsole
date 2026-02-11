import { useCallback, useMemo, useLayoutEffect, useRef, useState } from 'react'
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
  const zoomBehaviorRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)
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
  const gridWidth = columns * CELL_WIDTH + (columns - 1) * GRID_GAP
  const gridHeight = rows * CELL_HEIGHT + (rows - 1) * GRID_GAP

  const centers = layouts.reduce<Record<string, { x: number; y: number }>>((acc, entry, index) => {
    const col = index % columns
    const row = Math.floor(index / columns)
    const centerX = col * (CELL_WIDTH + GRID_GAP) + CELL_WIDTH / 2
    const centerY = row * (CELL_HEIGHT + GRID_GAP) + CELL_HEIGHT / 2
    acc[entry.diagram.id] = { x: centerX, y: centerY }
    return acc
  }, {})

  const computeFitTransform = useCallback(() => {
    if (!svgRef.current) return zoomIdentity
    const { width: svgW, height: svgH } = svgRef.current.getBoundingClientRect()
    if (svgW === 0 || svgH === 0) return zoomIdentity
    const padding = 20
    const scale = Math.min((svgW - padding * 2) / gridWidth, (svgH - padding * 2) / gridHeight)
    const tx = svgW / 2 - (gridWidth / 2) * scale
    const ty = svgH / 2 - (gridHeight / 2) * scale
    return zoomIdentity.translate(tx, ty).scale(scale)
  }, [gridWidth, gridHeight])

  useLayoutEffect(() => {
    if (!svgRef.current) return

    const svgEl = svgRef.current
    const svg = select(svgEl)
    const { width: svgW, height: svgH } = svgEl.getBoundingClientRect()
    if (svgW === 0 || svgH === 0) return

    const initialTransform = computeFitTransform()

    const zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 8])
      .wheelDelta((event) => -event.deltaY * (event.deltaMode === 1 ? 0.005 : event.deltaMode ? 0.1 : 0.0002))
      .on('zoom', (event) => {
        setTransform(event.transform)
      })

    zoomBehaviorRef.current = zoomBehavior
    svg.call(zoomBehavior)
    svg.call(zoomBehavior.transform, initialTransform)

    return () => {
      svg.on('.zoom', null)
    }
  }, [gridWidth, gridHeight, computeFitTransform])

  const handleReset = useCallback(() => {
    if (!svgRef.current || !zoomBehaviorRef.current) return
    const fitTransform = computeFitTransform()
    select(svgRef.current).call(zoomBehaviorRef.current.transform, fitTransform)
  }, [computeFitTransform])

  return (
    <div className="diagram-canvas system-canvas" style={{ overflow: 'hidden' }}>
      <svg
        ref={svgRef}
        className="diagram-svg"
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
                            className="edge-path"
                            markerEnd="url(#arrow-system)"
                            vectorEffect="non-scaling-stroke"
                          />
                          {edge.label && midPoint ? (
                            <text
                              x={midPoint.x}
                              y={midPoint.y - 10}
                              className="edge-label"
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
                          className={`node ${visited ? 'visited' : ''} ${current ? 'current' : ''}`}
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
      <div className="zoom-info">
        <span>{Math.round(transform.k * 100)}%</span>
        <span className="zoom-info-sep">·</span>
        <span>x: {Math.round(transform.x)}</span>
        <span className="zoom-info-sep">·</span>
        <span>y: {Math.round(transform.y)}</span>
        <button type="button" className="zoom-reset" onClick={handleReset} title="Reset zoom">
          ⟲
        </button>
      </div>
    </div>
  )
}
