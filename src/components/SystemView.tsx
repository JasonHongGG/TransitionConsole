import { useCallback, useEffect, useMemo, useLayoutEffect, useRef, useState } from 'react'
import { curveCatmullRom, line, select, zoom, type ZoomBehavior, zoomIdentity } from 'd3'
import type { CoverageState, Diagram, DiagramConnector, ElementExecutionStatus } from '../types'
import { computeSystemLayout } from '../utils/systemLayout'

const WHEEL_ZOOM_STEP = Math.log2(1.1)

interface SystemViewProps {
  diagrams: Diagram[]
  connectors: DiagramConnector[]
  coverage: CoverageState
  currentStateId: string | null
  selectedDiagramId?: string
  isTesting?: boolean
  activeEdgeId?: string | null
  nextStateId?: string | null
}

interface NodeRelationItem {
  id: string
  targetNodeId: string | null
  targetLabel: string
  targetDiagramName: string
  reason: string
}

const EDGE_STATUSES: ElementExecutionStatus[] = ['untested', 'running', 'pass', 'fail']

export const SystemView = ({
  diagrams,
  connectors,
  coverage,
  currentStateId,
  selectedDiagramId,
  isTesting = false,
  activeEdgeId = null,
  nextStateId = null,
}: SystemViewProps) => {
  const systemLayout = useMemo(
    () => computeSystemLayout(diagrams, connectors),
    [diagrams, connectors],
  )
  const diagramsById = useMemo(() => new Map(diagrams.map((diagram) => [diagram.id, diagram])), [diagrams])
  const nodesById = useMemo(() => new Map(systemLayout.nodes.map((node) => [node.id, node])), [systemLayout.nodes])

  const svgRef = useRef<SVGSVGElement>(null)
  const viewportRef = useRef<SVGGElement>(null)
  const zoomBehaviorRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const transformRef = useRef(zoomIdentity)
  const frameRef = useRef<number | null>(null)
  const [zoomInfo, setZoomInfo] = useState({ k: 1, x: 0, y: 0 })
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [nodeHistory, setNodeHistory] = useState<string[]>([])

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

  const markerFill = useCallback(
    (status: ElementExecutionStatus, markerKind: 'system' | 'connector' | 'variant') => {
      if (status === 'running') return 'rgba(255, 204, 119, 0.98)'
      if (status === 'pass') return 'rgba(96, 214, 156, 0.95)'
      if (status === 'fail') return 'rgba(244, 103, 103, 0.95)'
      if (markerKind === 'connector' || markerKind === 'variant') {
        return isTesting ? 'rgba(255, 255, 255, 0.85)' : 'var(--accent)'
      }
      return 'rgba(255, 255, 255, 0.35)'
    },
    [isTesting],
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

  const focusNode = useCallback(
    (nodeId: string, options: { pushHistory?: boolean } = {}) => {
      const node = nodesById.get(nodeId)
      if (!node) return

      if (options.pushHistory && selectedNodeId && selectedNodeId !== nodeId) {
        setNodeHistory((prev) => [...prev, selectedNodeId].slice(-40))
      }

      setSelectedNodeId(nodeId)

      if (!svgRef.current || !zoomBehaviorRef.current) return
      const { width: svgW, height: svgH } = svgRef.current.getBoundingClientRect()
      if (svgW === 0 || svgH === 0) return

      const scale = Math.max(transformRef.current.k, 1.15)
      const tx = svgW / 2 - node.x * scale
      const ty = svgH / 2 - node.y * scale
      const targetTransform = zoomIdentity.translate(tx, ty).scale(scale)

      select(svgRef.current)
        .transition()
        .duration(420)
        .call(zoomBehaviorRef.current.transform, targetTransform)
    },
    [nodesById, selectedNodeId],
  )

  const handleBackToPreviousNode = useCallback(() => {
    if (nodeHistory.length === 0) return
    const previousNodeId = nodeHistory[nodeHistory.length - 1]
    setNodeHistory((prev) => prev.slice(0, -1))
    focusNode(previousNodeId)
  }, [focusNode, nodeHistory])

  const selectedNode = selectedNodeId ? nodesById.get(selectedNodeId) ?? null : null

  const selectedNodeDetails = useMemo(() => {
    if (!selectedNode) return null
    const sourceDiagram = diagramsById.get(selectedNode.diagramId)
    if (!sourceDiagram) return null

    const toRelationTarget = (targetNodeId: string | null, fallbackDiagramId: string) => {
      if (targetNodeId) {
        const targetNode = nodesById.get(targetNodeId)
        if (targetNode) {
          const targetDiagramName = diagramsById.get(targetNode.diagramId)?.name ?? targetNode.diagramId
          return {
            targetNodeId,
            targetLabel: targetNode.label,
            targetDiagramName,
          }
        }
      }
      return {
        targetNodeId,
        targetLabel: targetNodeId ?? '(diagram) ',
        targetDiagramName: diagramsById.get(fallbackDiagramId)?.name ?? fallbackDiagramId,
      }
    }

    const outgoingTransitions: NodeRelationItem[] = sourceDiagram.transitions
      .filter((transition) => transition.from === selectedNode.id)
      .map((transition) => {
        const target = toRelationTarget(transition.to, sourceDiagram.id)
        return {
          id: transition.id,
          ...target,
          reason: transition.meta.source.raw || transition.event || transition.intent.summary || transition.id,
        }
      })

    const incomingTransitions: NodeRelationItem[] = sourceDiagram.transitions
      .filter((transition) => transition.to === selectedNode.id)
      .map((transition) => {
        const target = toRelationTarget(transition.from, sourceDiagram.id)
        return {
          id: transition.id,
          ...target,
          reason: transition.meta.source.raw || transition.event || transition.intent.summary || transition.id,
        }
      })

    const outgoingConnectors: NodeRelationItem[] = connectors
      .filter((connector) => connector.from.stateId === selectedNode.id)
      .map((connector) => {
        const target = toRelationTarget(connector.to.stateId, connector.to.diagramId)
        return {
          id: connector.id,
          ...target,
          reason: connector.meta.reason,
        }
      })

    const incomingConnectors: NodeRelationItem[] = connectors
      .filter((connector) => connector.to.stateId === selectedNode.id)
      .map((connector) => {
        const target = toRelationTarget(connector.from.stateId, connector.from.diagramId)
        return {
          id: connector.id,
          ...target,
          reason: connector.meta.reason,
        }
      })

    return {
      sourceDiagramName: sourceDiagram.name,
      outgoingTransitions,
      incomingTransitions,
      outgoingConnectors,
      incomingConnectors,
    }
  }, [selectedNode, diagramsById, nodesById, connectors])

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
        if (event.deltaY === 0) return 0
        return event.deltaY < 0 ? WHEEL_ZOOM_STEP : -WHEEL_ZOOM_STEP
      })
      .on('zoom', (event) => {
        transformRef.current = event.transform
        if (viewportRef.current) {
          viewportRef.current.setAttribute('transform', event.transform.toString())
        }

        if (frameRef.current === null) {
          frameRef.current = window.requestAnimationFrame(() => {
            const latest = transformRef.current
            setZoomInfo({ k: latest.k, x: latest.x, y: latest.y })
            frameRef.current = null
          })
        }
      })

    zoomBehaviorRef.current = zoomBehavior
    svg.call(zoomBehavior)
    svg.call(zoomBehavior.transform, initialTransform)

    return () => {
      svg.on('.zoom', null)
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [computeFitTransform])

  const handleReset = useCallback(() => {
    if (!svgRef.current || !zoomBehaviorRef.current) return
    const fitTransform = computeFitTransform()
    select(svgRef.current).call(zoomBehaviorRef.current.transform, fitTransform)
  }, [computeFitTransform])

  // Zoom to selected diagram group, or zoom-to-fit when deselected
  useEffect(() => {
    if (!svgRef.current || !zoomBehaviorRef.current) return
    const svgEl = svgRef.current
    const { width: svgW, height: svgH } = svgEl.getBoundingClientRect()
    if (svgW === 0 || svgH === 0) return

    let targetTransform = computeFitTransform()

    if (selectedDiagramId) {
      const group = systemLayout.groups.find((g) => g.id === selectedDiagramId)
      if (group) {
        const diameter = group.radius * 2 + 80
        const scale = Math.min(svgW / diameter, svgH / diameter)
        const tx = svgW / 2 - group.cx * scale
        const ty = svgH / 2 - group.cy * scale
        targetTransform = zoomIdentity.translate(tx, ty).scale(scale)
      }
    }

    select(svgEl)
      .transition()
      .duration(600)
      .call(zoomBehaviorRef.current.transform, targetTransform)
  }, [selectedDiagramId, systemLayout.groups, computeFitTransform])

  useEffect(() => {
    if (!selectedNodeId) return
    if (!nodesById.has(selectedNodeId)) {
      queueMicrotask(() => {
        setSelectedNodeId(null)
        setNodeHistory([])
      })
    }
  }, [selectedNodeId, nodesById])

  const renderRelationSection = (title: string, items: NodeRelationItem[]) => (
    <section className="system-node-info-section">
      <div className="system-node-info-section-head">
        <div className="system-node-info-section-title">{title}</div>
        <span className="system-node-info-count">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div className="system-node-info-empty">None</div>
      ) : (
        <ul className="system-node-info-list">
          {items.map((item) => (
            <li key={item.id} className="system-node-info-item">
              <div className="system-node-info-item-head">
                {item.targetNodeId ? (
                  <button
                    type="button"
                    className="system-node-jump"
                    onClick={() => focusNode(item.targetNodeId ?? '', { pushHistory: true })}
                    title="Jump to related node"
                  >
                    {item.targetLabel}
                  </button>
                ) : (
                  <span className="system-node-static">{item.targetLabel}</span>
                )}
                <span className="system-node-info-diagram">{item.targetDiagramName}</span>
              </div>
              <p className="system-node-info-reason">{item.reason}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )

  return (
    <div className={`diagram-canvas system-canvas ${isTesting ? 'testing-active' : 'testing-inactive'}`} style={{ overflow: 'hidden' }}>
      {selectedNode && selectedNodeDetails ? (
        <aside className="system-node-info-panel" role="region" aria-label="Selected node details">
          <div className="system-node-info-header">
            <div>
              <p className="system-node-info-kicker">Node</p>
              <h4 className="system-node-info-title">{selectedNode.label}</h4>
              <p className="system-node-info-meta">{selectedNodeDetails.sourceDiagramName}</p>
              <p className="system-node-info-meta muted-id">{selectedNode.id}</p>
            </div>
            <div className="system-node-info-actions">
              <button
                type="button"
                className="system-node-panel-btn"
                onClick={handleBackToPreviousNode}
                disabled={nodeHistory.length === 0}
                title="Back to previous node"
              >
                Back
              </button>
              <button
                type="button"
                className="system-node-panel-btn"
                onClick={() => {
                  setSelectedNodeId(null)
                  setNodeHistory([])
                }}
              >
                Close
              </button>
            </div>
          </div>

          <div className="system-node-info-overview">
            <div className="system-node-info-stat">
              <span>Transitions</span>
              <strong>{selectedNodeDetails.outgoingTransitions.length + selectedNodeDetails.incomingTransitions.length}</strong>
            </div>
            <div className="system-node-info-stat">
              <span>Connectors</span>
              <strong>{selectedNodeDetails.outgoingConnectors.length + selectedNodeDetails.incomingConnectors.length}</strong>
            </div>
          </div>

          <div className="system-node-info-cluster">
            <p className="system-node-info-cluster-title">Transition Path</p>
            {renderRelationSection('Outgoing', selectedNodeDetails.outgoingTransitions)}
            {renderRelationSection('Incoming', selectedNodeDetails.incomingTransitions)}
          </div>

          <div className="system-node-info-cluster">
            <p className="system-node-info-cluster-title">Connector</p>
            {renderRelationSection('Outgoing', selectedNodeDetails.outgoingConnectors)}
            {renderRelationSection('Incoming', selectedNodeDetails.incomingConnectors)}
          </div>
        </aside>
      ) : null}

      <svg
        ref={svgRef}
        className="diagram-svg"
        role="img"
        style={{ cursor: 'grab' }}
      >
        <defs>
          {EDGE_STATUSES.map((status) => (
            <marker
              key={`arrow-system-${status}`}
              id={`arrow-system-${status}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={markerFill(status, 'system')} />
            </marker>
          ))}
          {EDGE_STATUSES.map((status) => (
            <marker
              key={`arrow-connector-${status}`}
              id={`arrow-connector-${status}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={markerFill(status, 'connector')} />
            </marker>
          ))}
          {EDGE_STATUSES.map((status) => (
            <marker
              key={`arrow-variant-${status}`}
              id={`arrow-variant-${status}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={markerFill(status, 'variant')} />
            </marker>
          ))}
        </defs>

        <g ref={viewportRef}>
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

          {/* Base/delta variant edges */}
          <g className="variant-edges">
            {systemLayout.variantEdges.map((edge) => {
              const edgeStatus = resolveEdgeStatus(edge.id)
              const midX = (edge.from.x + edge.to.x) / 2
              const midY = (edge.from.y + edge.to.y) / 2
              const roleText = edge.roles.length > 0 ? edge.roles.join(' | ') : 'all roles'
              return (
                <g key={edge.id} className={`edge-status-${edgeStatus}`}>
                  <path
                    d={`M ${edge.from.x} ${edge.from.y} L ${edge.to.x} ${edge.to.y}`}
                    className="variant-edge-path"
                    markerEnd={`url(#arrow-variant-${edgeStatus})`}
                    vectorEffect="non-scaling-stroke"
                  />
                  <text x={midX} y={midY - 8} className="variant-edge-label" textAnchor="middle">
                    extends ({roleText})
                  </text>
                </g>
              )
            })}
          </g>

          {/* Cross-diagram connector edges (explicit state-to-state) */}
          <g className="cross-edges">
            {systemLayout.crossEdges.map((edge) => {
              const edgeStatus = resolveEdgeStatus(edge.id)
              const midX = (edge.from.x + edge.to.x) / 2
              const midY = (edge.from.y + edge.to.y) / 2
              const dx = edge.to.x - edge.from.x
              const dy = edge.to.y - edge.from.y
              const len = Math.sqrt(dx * dx + dy * dy) || 1
              const baseOffset = Math.min(len * 0.15, 50)
              const laneCenter = (edge.parallelCount - 1) / 2
              const laneOffset = (edge.parallelIndex - laneCenter) * 14
              const offset = baseOffset + laneOffset
              const cpX = midX - (dy / len) * offset
              const cpY = midY + (dx / len) * offset

              const labelOffset = 8 + Math.abs(laneOffset) * 0.35

              const path = edgeLine([
                { x: edge.from.x, y: edge.from.y },
                { x: cpX, y: cpY },
                { x: edge.to.x, y: edge.to.y },
              ])
              return (
                <g key={edge.id} className={`edge-status-${edgeStatus}`}>
                  <path
                    d={path ?? ''}
                    className="cross-edge-path"
                    markerEnd={`url(#arrow-connector-${edgeStatus})`}
                    vectorEffect="non-scaling-stroke"
                  />
                  <text x={cpX} y={cpY - labelOffset} className="cross-edge-label" textAnchor="middle">
                    {edge.label}
                  </text>
                </g>
              )
            })}
          </g>

          {/* Intra-diagram edges */}
          <g className="diagram-edges">
            {systemLayout.intraEdges.map((edge) => {
              const edgeStatus = resolveEdgeStatus(edge.id)
              const path = edgeLine(edge.points) ?? ''
              const midPoint = edge.points[Math.floor(edge.points.length / 2)]
              return (
                <g key={edge.id} className={`edge-status-${edgeStatus}`}>
                  <path
                    d={path}
                    className="edge-path"
                    markerEnd={`url(#arrow-system-${edgeStatus})`}
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
              const executionStatus = resolveNodeStatus(node.id)
              const visited = coverage.visitedNodes.has(node.id)
              const current = currentStateId === node.id
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x - node.width / 2}, ${node.y - node.height / 2})`}
                  className={`node ${node.type} ${visited ? 'visited' : ''} ${current ? 'current' : ''} ${selectedNodeId === node.id ? 'selected' : ''} node-status-${executionStatus}`}
                  onClick={() => focusNode(node.id)}
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
        <span>{Math.round(zoomInfo.k * 100)}%</span>
        <span className="zoom-info-sep">·</span>
        <span>x: {Math.round(zoomInfo.x)}</span>
        <span className="zoom-info-sep">·</span>
        <span>y: {Math.round(zoomInfo.y)}</span>
        <span className="zoom-info-sep">·</span>
        <span>connectors: {systemLayout.crossEdges.length}</span>
        <span className="zoom-info-sep">·</span>
        <span>variants: {systemLayout.variantEdges.length}</span>
        <button type="button" className="zoom-reset" onClick={handleReset} title="Reset zoom">
          ⟲
        </button>
      </div>
    </div>
  )
}
