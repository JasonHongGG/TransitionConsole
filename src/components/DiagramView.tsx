import { useCallback, useMemo, useLayoutEffect, useRef, useState } from 'react'
import { curveCatmullRom, line, select, zoom, type ZoomBehavior, type ZoomTransform, zoomIdentity } from 'd3'
import type { CoverageState, Diagram } from '../types'
import { layoutDiagram } from '../utils/layout'

interface DiagramViewProps {
  diagram: Diagram
  coverage: CoverageState
  currentStateId: string | null
}

// Persist zoom transforms per diagram so switching doesn't reset
const savedTransforms = new Map<string, ZoomTransform>()

export const DiagramView = ({ diagram, coverage, currentStateId }: DiagramViewProps) => {
  const layout = useMemo(() => layoutDiagram(diagram), [diagram])
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
    const cx = (layout.bounds.minX + layout.bounds.maxX) / 2
    const cy = (layout.bounds.minY + layout.bounds.maxY) / 2
    const dw = layout.width + 100
    const dh = layout.height + 100
    const scale = Math.min(svgW / dw, svgH / dh)
    const tx = svgW / 2 - cx * scale
    const ty = svgH / 2 - cy * scale
    return zoomIdentity.translate(tx, ty).scale(scale)
  }, [layout])

  useLayoutEffect(() => {
    if (!svgRef.current) return

    const svgEl = svgRef.current
    const svg = select(svgEl)
    const { width: svgW, height: svgH } = svgEl.getBoundingClientRect()
    if (svgW === 0 || svgH === 0) return

    const diagramId = diagram.id
    const targetTransform = savedTransforms.get(diagramId) ?? computeFitTransform()

    const zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.05, 5])
      .wheelDelta((event) => -event.deltaY * (event.deltaMode === 1 ? 0.005 : event.deltaMode ? 0.1 : 0.0002))
      .on('zoom', (event) => {
        setTransform(event.transform)
        savedTransforms.set(diagramId, event.transform)
      })

    zoomBehaviorRef.current = zoomBehavior
    svg.call(zoomBehavior)
    svg.call(zoomBehavior.transform, targetTransform)

    return () => {
      svg.on('.zoom', null)
    }
  }, [layout, diagram.id, computeFitTransform])

  const handleReset = useCallback(() => {
    if (!svgRef.current || !zoomBehaviorRef.current) return
    savedTransforms.delete(diagram.id)
    const fitTransform = computeFitTransform()
    select(svgRef.current).call(zoomBehaviorRef.current.transform, fitTransform)
  }, [diagram.id, computeFitTransform])

  return (
    <div className="diagram-canvas" style={{ overflow: 'hidden' }}>
      <svg
        ref={svgRef}
        className="diagram-svg"
        role="img"
        style={{ cursor: 'grab' }}
      >
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

        <g transform={transform.toString()} style={{ transition: 'transform 0.05s linear' }}>
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
