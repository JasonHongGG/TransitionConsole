import { useMemo, useEffect, useRef, useState } from 'react'
import { curveCatmullRom, line, select, zoom, type ZoomBehavior, zoomIdentity } from 'd3'
import type { CoverageState, Diagram } from '../types'
import { layoutDiagram } from '../utils/layout'

interface DiagramViewProps {
  diagram: Diagram
  coverage: CoverageState
  currentStateId: string | null
}

export const DiagramView = ({ diagram, coverage, currentStateId }: DiagramViewProps) => {
  const layout = useMemo(() => layoutDiagram(diagram), [diagram])
  const svgRef = useRef<SVGSVGElement>(null)

  // State to track d3-zoom transform
  // We strictly initialize to Identity (k=1, x=0, y=0)
  // This means the initial render is exactly consistent with the base viewBox layout.
  const [transform, setTransform] = useState(zoomIdentity)

  const edgeLine = useMemo(
    () =>
      line<{ x: number; y: number }>()
        .x((d) => d.x)
        .y((d) => d.y)
        .curve(curveCatmullRom.alpha(0.7)),
    [],
  )

  // We persist the original viewBox logic to ensure LAYOUT STABILITY.
  // The viewBox establishes the "base coordinate system" where the diagram fits effectively.
  const viewBox = `${layout.bounds.minX - 80} ${layout.bounds.minY - 80} ${layout.width + 160} ${layout.height + 160}`

  useEffect(() => {
    if (!svgRef.current) return

    const svg = select(svgRef.current)

    const zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4]) // Allow zooming out to 0.2x and in to 4x of the "fit" size
      .on('zoom', (event) => {
        setTransform(event.transform)
      })

    // Apply the zoom behavior
    svg.call(zoomBehavior)

    // IMPORTANT: we do NOT manually set an initial transform here from clientRects.
    // We rely on the SVG viewBox to handle the initial "Fit to Screen".
    // d3-zoom's internal state starts at Identity (k=1, x=0, y=0), which matches our render state.

    return () => {
      svg.on('.zoom', null)
    }
  }, [layout]) // Re-bind if layout (and thus viewBox) changes fundamentally

  // Hide labels when zoomed out.
  // Since k=1 represents "Fit to Screen" (the initial view),
  // k < 0.6 means we are significantly smaller than the fitted view.
  const showLabels = transform.k >= 0.6

  return (
    <div className="diagram-canvas" style={{ overflow: 'hidden' }}>
      <svg
        ref={svgRef}
        className="diagram-svg"
        viewBox={viewBox}
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

        {/* 
          We wrap the content in a group that receives the zoom transform.
          The transform is applied ON TOP of the viewBox coordinate system.
          Initial state is Identity, so initial render is identical to original.
        */}
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
                    vectorEffect="non-scaling-stroke" // Tries to keep stroke width consistent visually
                  />
                  {edge.label && midPoint && showLabels ? (
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
    </div>
  )
}
