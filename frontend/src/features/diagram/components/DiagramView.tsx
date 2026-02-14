import { useCallback, useEffect, useMemo, useLayoutEffect, useRef, useState } from 'react'
import { curveCatmullRom, line, select, zoom, type ZoomBehavior, type ZoomTransform, zoomIdentity } from 'd3'
import type { CoverageState, Diagram, ElementExecutionStatus } from '../../../types'
import { layoutDiagram } from '../../../shared/utils/layout'

interface DiagramViewProps {
  diagram: Diagram
  coverage: CoverageState
  currentStateId: string | null
  isTesting?: boolean
  activeEdgeId?: string | null
  nextStateId?: string | null
  focusMode?: 'off' | 'current' | 'path'
}

const EDGE_STATUSES: ElementExecutionStatus[] = ['untested', 'running', 'pass', 'fail']

// Persist zoom transforms per diagram so switching doesn't reset
const savedTransforms = new Map<string, ZoomTransform>()
const WHEEL_ZOOM_STEP = Math.log2(1.1)

export const DiagramView = ({
  diagram,
  coverage,
  currentStateId,
  isTesting = false,
  activeEdgeId = null,
  nextStateId = null,
  focusMode = 'path',
}: DiagramViewProps) => {
  const layout = useMemo(() => layoutDiagram(diagram), [diagram])
  const svgRef = useRef<SVGSVGElement>(null)
  const zoomBehaviorRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const [transform, setTransform] = useState(zoomIdentity)

  const resolveNodeStatus = useCallback(
    (nodeId: string): ElementExecutionStatus => {
      if (isTesting && nextStateId === nodeId) {
        return 'running'
      }
      if (coverage.nodeStatuses && coverage.nodeStatuses[nodeId]) {
        return coverage.nodeStatuses[nodeId]
      }
      if (currentStateId === nodeId) return 'running'
      if (coverage.visitedNodes.has(nodeId)) return 'pass'
      return 'untested'
    },
    [isTesting, nextStateId, coverage.nodeStatuses, coverage.visitedNodes, currentStateId],
  )

  const resolveEdgeStatus = useCallback(
    (edgeId: string): ElementExecutionStatus => {
      if (isTesting && activeEdgeId === edgeId) {
        return 'running'
      }
      if (coverage.edgeStatuses && coverage.edgeStatuses[edgeId]) {
        return coverage.edgeStatuses[edgeId]
      }
      const result = coverage.transitionResults[edgeId]
      if (result === 'pass' || result === 'fail') return result
      return 'untested'
    },
    [isTesting, activeEdgeId, coverage.edgeStatuses, coverage.transitionResults],
  )

  const edgeLine = useMemo(
    () =>
      line<{ x: number; y: number }>()
        .x((d) => d.x)
        .y((d) => d.y)
        .curve(curveCatmullRom.alpha(0.7)),
    [],
  )

  const markerFill = useCallback((status: ElementExecutionStatus) => {
    if (status === 'running') return 'rgba(255, 204, 119, 0.98)'
    if (status === 'pass') return 'rgba(96, 214, 156, 0.95)'
    if (status === 'fail') return 'rgba(244, 103, 103, 0.95)'
    return 'rgba(255, 255, 255, 0.35)'
  }, [])

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
      .wheelDelta((event) => {
        if (event.deltaY === 0) return 0
        return event.deltaY < 0 ? WHEEL_ZOOM_STEP : -WHEEL_ZOOM_STEP
      })
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

  useEffect(() => {
    if (focusMode === 'off') return
    if (!svgRef.current || !zoomBehaviorRef.current) return

    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY

    const includePoint = (x: number, y: number) => {
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }

    const includeNodeBounds = (node: { x: number; y: number; width: number; height: number }) => {
      includePoint(node.x - node.width / 2, node.y - node.height / 2)
      includePoint(node.x + node.width / 2, node.y + node.height / 2)
    }

    let hasTarget = false
    const currentNode = currentStateId ? layout.nodes.find((node) => node.id === currentStateId) : null
    const nextNode = nextStateId ? layout.nodes.find((node) => node.id === nextStateId) : null

    if (currentNode) {
      includeNodeBounds(currentNode)
      hasTarget = true
    } else if (nextNode) {
      includeNodeBounds(nextNode)
      hasTarget = true
    }

    if (focusMode === 'path' && currentNode) {
      if (nextNode) {
        includeNodeBounds(nextNode)
        hasTarget = true
      }

      const activeEdge = activeEdgeId ? layout.edges.find((edge) => edge.id === activeEdgeId) : null
      if (activeEdge?.points.length) {
        const edgeCenter = activeEdge.points[Math.floor(activeEdge.points.length / 2)]
        includePoint(edgeCenter.x, edgeCenter.y)
      }
    }

    if (!hasTarget) return

    const { width: svgW, height: svgH } = svgRef.current.getBoundingClientRect()
    if (svgW === 0 || svgH === 0) return

    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2

    const targetScale = (() => {
      if (focusMode === 'current') {
        return 3.6
      }
      const padding = 56
      const focusW = Math.max(1, maxX - minX + padding * 2)
      const focusH = Math.max(1, maxY - minY + padding * 2)
      const fitScale = Math.min(svgW / focusW, svgH / focusH)
      return Math.min(2.8, fitScale)
    })()

    const scale = Math.max(0.05, Math.min(5, targetScale))
    const targetTransform = zoomIdentity
      .translate(svgW / 2 - centerX * scale, svgH / 2 - centerY * scale)
      .scale(scale)

    select(svgRef.current)
      .transition()
      .duration(280)
      .call(zoomBehaviorRef.current.transform, targetTransform)
  }, [focusMode, currentStateId, nextStateId, activeEdgeId, layout.nodes, layout.edges])

  return (
    <div className="diagram-canvas" style={{ overflow: 'hidden' }}>
      <svg
        ref={svgRef}
        className="diagram-svg"
        role="img"
        style={{ cursor: 'grab' }}
      >
        <defs>
          {EDGE_STATUSES.map((status) => (
            <marker
              key={`arrow-${status}`}
              id={`arrow-${status}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={markerFill(status)} />
            </marker>
          ))}
        </defs>

        <g transform={transform.toString()} style={{ transition: 'transform 0.05s linear' }}>
          <g className="diagram-edges">
            {layout.edges.map((edge) => {
              const edgeStatus = resolveEdgeStatus(edge.id)
              const path = edgeLine(edge.points) ?? ''
              const midPoint = edge.points[Math.floor(edge.points.length / 2)]
              return (
                <g key={edge.id} className={`edge-status-${edgeStatus}`}>
                  <path
                    d={path}
                    className="edge-path"
                    markerEnd={`url(#arrow-${edgeStatus})`}
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
              const executionStatus = resolveNodeStatus(node.id)
              const visited = coverage.visitedNodes.has(node.id)
              const current = currentStateId === node.id
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x - node.width / 2}, ${node.y - node.height / 2})`}
                  className={`node ${node.type} ${visited ? 'visited' : ''} ${current ? 'current' : ''} node-status-${executionStatus}`}
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
