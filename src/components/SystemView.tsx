import { useCallback, useMemo, useLayoutEffect, useRef, useState } from 'react'
import { curveCatmullRom, line, select, zoom, type ZoomBehavior, zoomIdentity } from 'd3'
import type { CoverageState, Diagram, DiagramConnector } from '../types'
import { computeSystemLayout } from '../utils/systemLayout'

interface SystemViewProps {
  diagrams: Diagram[]
  connectors: DiagramConnector[]
  coverage: CoverageState
  currentStateId: string | null
}

export const SystemView = ({ diagrams, connectors, coverage, currentStateId }: SystemViewProps) => {
  const systemLayout = useMemo(
    () => computeSystemLayout(diagrams, connectors),
    [diagrams, connectors],
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

  const computeFitTransform = useCallback(() => {
    if (!svgRef.current) return zoomIdentity
    const { width: svgW, height: svgH } = svgRef.current.getBoundingClientRect()
    if (svgW === 0 || svgH === 0) return zoomIdentity

    const cx = (systemLayout.bounds.minX + systemLayout.bounds.maxX) / 2
    const cy = (systemLayout.bounds.minY + systemLayout.bounds.maxY) / 2
    const dw = systemLayout.width + 120
    const dh = systemLayout.height + 120
    const scale = Math.min(svgW / dw, svgH / dh)
    const tx = svgW / 2 - cx * scale
    const ty = svgH / 2 - cy * scale
    return zoomIdentity.translate(tx, ty).scale(scale)
  }, [systemLayout])

  useLayoutEffect(() => {
    if (!svgRef.current) return

    const svgEl = svgRef.current
    const svg = select(svgEl)
    const { width: svgW, height: svgH } = svgEl.getBoundingClientRect()
    if (svgW === 0 || svgH === 0) return

    const initialTransform = computeFitTransform()

    const zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.02, 8])
      .wheelDelta((event) => {
        const abs = Math.abs(event.deltaY)
        const speed = Math.pow(abs / 100, 1.4) * 0.0002
        const base = event.deltaMode === 1 ? 0.005 : event.deltaMode ? 0.1 : speed
        return -event.deltaY * base / (abs || 1) * abs
      })
      .on('zoom', (event) => {
        setTransform(event.transform)
      })

    zoomBehaviorRef.current = zoomBehavior
    svg.call(zoomBehavior)
    svg.call(zoomBehavior.transform, initialTransform)

    return () => {
      svg.on('.zoom', null)
    }
  }, [computeFitTransform])

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
          <marker
            id="arrow-connector"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)" />
          </marker>
        </defs>

        <g transform={transform.toString()} style={{ transition: 'transform 0.05s linear' }}>
          {/* Diagram group backgrounds */}
          <g className="system-groups">
            {systemLayout.groups.map((group) => (
              <g key={group.id}>
                <circle
                  cx={group.cx}
                  cy={group.cy}
                  r={group.radius}
                  className="diagram-group-bg"
                />
                <text
                  x={group.cx}
                  y={group.cy - group.radius - 8}
                  className="diagram-group-label"
                  textAnchor="middle"
                >
                  {group.name}
                </text>
              </g>
            ))}
          </g>

          {/* Cross-diagram connector edges (behind intra edges) */}
          <g className="cross-edges">
            {systemLayout.crossEdges.map((edge) => {
              const midX = (edge.from.x + edge.to.x) / 2
              const midY = (edge.from.y + edge.to.y) / 2
              const dx = edge.to.x - edge.from.x
              const dy = edge.to.y - edge.from.y
              const len = Math.sqrt(dx * dx + dy * dy) || 1
              const offset = Math.min(len * 0.15, 50)
              const cpX = midX - (dy / len) * offset
              const cpY = midY + (dx / len) * offset

              const path = edgeLine([
                { x: edge.from.x, y: edge.from.y },
                { x: cpX, y: cpY },
                { x: edge.to.x, y: edge.to.y },
              ])
              return (
                <g key={edge.id}>
                  <path
                    d={path ?? ''}
                    className="cross-edge-path"
                    markerEnd="url(#arrow-connector)"
                    vectorEffect="non-scaling-stroke"
                  />
                  <text x={cpX} y={cpY - 8} className="cross-edge-label" textAnchor="middle">
                    {edge.label}
                  </text>
                </g>
              )
            })}
          </g>

          {/* Intra-diagram edges */}
          <g className="diagram-edges">
            {systemLayout.intraEdges.map((edge) => {
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
                    <text x={midPoint.x} y={midPoint.y - 10} className="edge-label">
                      {edge.label}
                    </text>
                  ) : null}
                </g>
              )
            })}
          </g>

          {/* All nodes */}
          <g className="diagram-nodes">
            {systemLayout.nodes.map((node) => {
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
