import { useId, useMemo, type CSSProperties, type Ref } from 'react'
import { curveCatmullRom, line } from 'd3'
import type { CoverageState, Diagram, DiagramConnector } from '../../../types'
import { computeSystemLayout, type SystemCrossEdge, type SystemLayout } from '../../../shared/utils/systemLayout'
import {
  EDGE_STATUSES,
  getSystemMarkerFill,
  resolveSystemEdgeStatus,
  resolveSystemNodeStatus,
  type SystemGraphViewBox,
  type SystemRenderMode,
} from '../utils/systemGraph'

interface SystemGraphSvgProps {
  diagrams: Diagram[]
  connectors: DiagramConnector[]
  coverage: CoverageState
  currentStateId: string | null
  selectedNodeId?: string | null
  systemLayout?: SystemLayout
  isTesting?: boolean
  activeEdgeId?: string | null
  nextStateId?: string | null
  onNodeClick?: (nodeId: string) => void
  svgRef?: Ref<SVGSVGElement>
  viewportRef?: Ref<SVGGElement>
  className?: string
  style?: CSSProperties
  viewBox?: string
  viewBoxBounds?: SystemGraphViewBox
  preserveAspectRatio?: string
  renderMode?: SystemRenderMode
  ariaLabel?: string
  graphClassName?: string
}

export const SystemGraphSvg = ({
  diagrams,
  connectors,
  coverage,
  currentStateId,
  selectedNodeId = null,
  systemLayout,
  isTesting = false,
  activeEdgeId = null,
  nextStateId = null,
  onNodeClick,
  svgRef,
  viewportRef,
  className,
  style,
  viewBox,
  viewBoxBounds,
  preserveAspectRatio,
  renderMode = 'interactive',
  ariaLabel = 'System transition diagram',
  graphClassName,
}: SystemGraphSvgProps) => {
  const markerPrefix = useId().replace(/:/g, '')
  const isPaperMode = renderMode === 'paper-full-system'

  const visibleConnectors = useMemo(
    () => connectors.filter((connector) => connector.type === 'invokes'),
    [connectors],
  )
  const layout = useMemo(
    () =>
      systemLayout ??
      computeSystemLayout(diagrams, visibleConnectors, {
        mode: renderMode,
      }),
    [diagrams, renderMode, systemLayout, visibleConnectors],
  )

  const edgeLine = useMemo(
    () =>
      line<{ x: number; y: number }>()
        .x((d) => d.x)
        .y((d) => d.y)
        .curve(curveCatmullRom.alpha(0.7)),
    [],
  )

  const buildCrossEdgePath = (edge: SystemCrossEdge) => {
    const midX = (edge.from.x + edge.to.x) / 2
    const midY = (edge.from.y + edge.to.y) / 2
    const laneCenter = (edge.parallelCount - 1) / 2
    const laneOffset = (edge.parallelIndex - laneCenter) * (isPaperMode ? 18 : 14)

    if (isPaperMode) {
      if (edge.fromRow !== edge.toRow) {
        const corridorY = midY + laneOffset
        return edgeLine([
          { x: edge.from.x, y: edge.from.y },
          { x: edge.from.x, y: corridorY },
          { x: edge.to.x, y: corridorY },
          { x: edge.to.x, y: edge.to.y },
        ])
      }

      const rowDirection = edge.fromRow === 'pages' ? -1 : 1
      const bendY = midY + rowDirection * (56 + Math.abs(laneOffset) * 0.35)
      return edgeLine([
        { x: edge.from.x, y: edge.from.y },
        { x: midX, y: bendY },
        { x: edge.to.x, y: edge.to.y },
      ])
    }

    const dx = edge.to.x - edge.from.x
    const dy = edge.to.y - edge.from.y
    const len = Math.sqrt(dx * dx + dy * dy) || 1
    const baseOffset = Math.min(len * 0.15, 50)
    const offset = baseOffset + laneOffset
    const cpX = midX - (dy / len) * offset
    const cpY = midY + (dx / len) * offset

    return edgeLine([
      { x: edge.from.x, y: edge.from.y },
      { x: cpX, y: cpY },
      { x: edge.to.x, y: edge.to.y },
    ])
  }

  const svgClassName = ['system-graph-svg-root', className ?? '', isPaperMode ? 'system-export-svg-root' : '']
    .filter(Boolean)
    .join(' ')

  const sceneClassName = [
    'system-canvas',
    isTesting ? 'testing-active' : 'testing-inactive',
    isPaperMode ? 'system-export-scene' : '',
    graphClassName ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <svg
      ref={svgRef}
      className={svgClassName}
      role="img"
      aria-label={ariaLabel}
      style={style}
      viewBox={viewBox}
      preserveAspectRatio={preserveAspectRatio}
    >
      <defs>
        {EDGE_STATUSES.map((status) => (
          <marker
            key={`arrow-system-${status}`}
            id={`${markerPrefix}-arrow-system-${status}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth={isPaperMode ? '4.4' : '6'}
            markerHeight={isPaperMode ? '4.4' : '6'}
            orient="auto-start-reverse"
          >
            <path
              d="M 0 0 L 10 5 L 0 10 z"
              fill={getSystemMarkerFill({ status, markerKind: 'system', isTesting, renderMode })}
            />
          </marker>
        ))}
        {EDGE_STATUSES.map((status) => (
          <marker
            key={`arrow-connector-${status}`}
            id={`${markerPrefix}-arrow-connector-${status}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth={isPaperMode ? '5.6' : '6'}
            markerHeight={isPaperMode ? '5.6' : '6'}
            orient="auto-start-reverse"
          >
            <path
              d="M 0 0 L 10 5 L 0 10 z"
              fill={getSystemMarkerFill({ status, markerKind: 'connector', isTesting, renderMode })}
            />
          </marker>
        ))}
        {EDGE_STATUSES.map((status) => (
          <marker
            key={`arrow-variant-${status}`}
            id={`${markerPrefix}-arrow-variant-${status}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth={isPaperMode ? '5.6' : '6'}
            markerHeight={isPaperMode ? '5.6' : '6'}
            orient="auto-start-reverse"
          >
            <path
              d="M 0 0 L 10 5 L 0 10 z"
              fill={getSystemMarkerFill({ status, markerKind: 'variant', isTesting, renderMode })}
            />
          </marker>
        ))}
      </defs>

      <g ref={viewportRef} className={sceneClassName}>
        {isPaperMode && viewBoxBounds ? (
          <rect
            className="system-export-bg"
            x={viewBoxBounds.minX}
            y={viewBoxBounds.minY}
            width={viewBoxBounds.width}
            height={viewBoxBounds.height}
          />
        ) : null}

        <g className="system-groups">
          {layout.groups.map((group) => (
            <g key={group.id}>
              {group.kind === 'rect' ? (
                <rect
                  x={group.cx - group.width / 2}
                  y={group.cy - group.height / 2}
                  width={group.width}
                  height={group.height}
                  rx={28}
                  ry={28}
                  className="diagram-group-bg"
                />
              ) : (
                <circle cx={group.cx} cy={group.cy} r={group.radius} className="diagram-group-bg" />
              )}
              <text x={group.labelX} y={group.labelY} className="diagram-group-label" textAnchor="middle">
                {group.name}
              </text>
            </g>
          ))}
        </g>

        <g className="variant-edges">
          {layout.variantEdges.map((edge) => {
            const edgeStatus = resolveSystemEdgeStatus({
              edgeId: edge.id,
              coverage,
              activeEdgeId,
              isTesting,
            })
            const midX = (edge.from.x + edge.to.x) / 2
            const midY = (edge.from.y + edge.to.y) / 2
            const roleText = edge.roles.length > 0 ? edge.roles.join(' | ') : 'all roles'
            return (
              <g key={edge.id} className={`edge-status-${edgeStatus}`}>
                <path
                  d={`M ${edge.from.x} ${edge.from.y} L ${edge.to.x} ${edge.to.y}`}
                  className="variant-edge-path"
                  markerEnd={`url(#${markerPrefix}-arrow-variant-${edgeStatus})`}
                  vectorEffect="non-scaling-stroke"
                />
                {!isPaperMode ? (
                  <text x={midX} y={midY - 8} className="variant-edge-label" textAnchor="middle">
                    extends ({roleText})
                  </text>
                ) : null}
              </g>
            )
          })}
        </g>

        <g className="cross-edges">
          {layout.crossEdges.map((edge) => {
            const edgeStatus = resolveSystemEdgeStatus({
              edgeId: edge.id,
              coverage,
              activeEdgeId,
              isTesting,
            })
            const path = buildCrossEdgePath(edge)
            const midX = (edge.from.x + edge.to.x) / 2
            const midY = (edge.from.y + edge.to.y) / 2

            return (
              <g key={edge.id} className={`edge-status-${edgeStatus}`}>
                <path
                  d={path ?? ''}
                  className="cross-edge-path"
                  markerEnd={`url(#${markerPrefix}-arrow-connector-${edgeStatus})`}
                  vectorEffect="non-scaling-stroke"
                />
                {!isPaperMode ? (
                  <text x={midX} y={midY - 12} className="cross-edge-label" textAnchor="middle">
                    {edge.label}
                  </text>
                ) : null}
              </g>
            )
          })}
        </g>

        <g className="diagram-edges">
          {layout.intraEdges.map((edge) => {
            const edgeStatus = resolveSystemEdgeStatus({
              edgeId: edge.id,
              coverage,
              activeEdgeId,
              isTesting,
            })
            const path = edgeLine(edge.points) ?? ''
            const midPoint = edge.points[Math.floor(edge.points.length / 2)]
            return (
              <g key={edge.id} className={`edge-status-${edgeStatus}`}>
                <path
                  d={path}
                  className="edge-path"
                  markerEnd={`url(#${markerPrefix}-arrow-system-${edgeStatus})`}
                  vectorEffect="non-scaling-stroke"
                />
                {!isPaperMode && edge.label && midPoint ? (
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
            const executionStatus = resolveSystemNodeStatus({
              nodeId: node.id,
              coverage,
              currentStateId,
              nextStateId,
              isTesting,
            })
            const visited = coverage.visitedNodes.has(node.id)
            const current = currentStateId === node.id
            const nodeClassName = [
              'node',
              node.type,
              visited ? 'visited' : '',
              current ? 'current' : '',
              selectedNodeId === node.id ? 'selected' : '',
              `node-status-${executionStatus}`,
            ]
              .filter(Boolean)
              .join(' ')

            return (
              <g
                key={node.id}
                transform={`translate(${node.x - node.width / 2}, ${node.y - node.height / 2})`}
                className={nodeClassName}
                onClick={onNodeClick ? () => onNodeClick(node.id) : undefined}
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
  )
}
