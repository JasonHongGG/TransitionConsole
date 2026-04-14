import type { CoverageState, ElementExecutionStatus } from '../../../types'
import type { SystemLayout } from '../../../shared/utils/systemLayout'

export type SystemMarkerKind = 'system' | 'connector' | 'variant'
export type SystemRenderMode = 'interactive' | 'paper-full-system'

export interface SystemPaperExportPreset {
  mode: 'paper-full-system'
  title: string
  viewBoxPadding: number
  defaultScale: 3
  fileSuffix: string
}

export interface SystemRenderSnapshot {
  coverage: CoverageState
  currentStateId: string | null
  activeEdgeId: string | null
  nextStateId: string | null
  isTesting: boolean
  capturedAt: string
}

export interface SystemGraphViewBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
  value: string
}

export const EDGE_STATUSES: ElementExecutionStatus[] = ['untested', 'running', 'pass', 'fail']

export const PAPER_FULL_SYSTEM_PRESET: SystemPaperExportPreset = {
  mode: 'paper-full-system',
  title: '完整系統論文圖',
  viewBoxPadding: 64,
  defaultScale: 3,
  fileSuffix: 'paper-full-system',
}

const PAPER_STATUS_STROKE: Record<ElementExecutionStatus, string> = {
  untested: '#6b7280',
  running: '#b7791f',
  pass: '#74cbb1',
  fail: '#dc2626',
}
const INTERACTIVE_IDLE_CONNECTOR = 'rgba(255, 204, 119, 0.92)'
const DARK_STATUS_STROKE: Record<ElementExecutionStatus, string> = {
  untested: 'rgba(255, 255, 255, 0.35)',
  running: 'rgba(255, 204, 119, 0.98)',
  pass: 'rgba(149, 233, 206, 0.96)',
  fail: 'rgba(244, 103, 103, 0.95)',
}

export function cloneCoverageState(coverage: CoverageState): CoverageState {
  return {
    visitedNodes: new Set(coverage.visitedNodes),
    transitionResults: { ...coverage.transitionResults },
    nodeStatuses: coverage.nodeStatuses ? { ...coverage.nodeStatuses } : undefined,
    edgeStatuses: coverage.edgeStatuses ? { ...coverage.edgeStatuses } : undefined,
  }
}

export function createSystemRenderSnapshot(input: {
  coverage: CoverageState
  currentStateId: string | null
  activeEdgeId: string | null
  nextStateId: string | null
  isTesting: boolean
}): SystemRenderSnapshot {
  return {
    coverage: cloneCoverageState(input.coverage),
    currentStateId: input.currentStateId,
    activeEdgeId: input.activeEdgeId,
    nextStateId: input.nextStateId,
    isTesting: input.isTesting,
    capturedAt: new Date().toISOString(),
  }
}

export function resolveSystemNodeStatus(input: {
  nodeId: string
  coverage: CoverageState
  currentStateId: string | null
  nextStateId: string | null
  isTesting: boolean
}): ElementExecutionStatus {
  const snapshotStatus = input.coverage.nodeStatuses?.[input.nodeId]
  if (snapshotStatus && snapshotStatus !== 'untested') {
    return snapshotStatus
  }
  if (input.isTesting && input.currentStateId === input.nodeId) return 'running'
  if (input.isTesting && input.nextStateId === input.nodeId) return 'running'
  if (snapshotStatus) {
    return snapshotStatus
  }
  if (input.coverage.visitedNodes.has(input.nodeId)) return 'pass'
  return 'untested'
}

export function resolveSystemEdgeStatus(input: {
  edgeId: string
  coverage: CoverageState
  activeEdgeId: string | null
  isTesting: boolean
}): ElementExecutionStatus {
  const snapshotStatus = input.coverage.edgeStatuses?.[input.edgeId]
  if (snapshotStatus && snapshotStatus !== 'untested') {
    return snapshotStatus
  }
  if (input.isTesting && input.activeEdgeId === input.edgeId) {
    return 'running'
  }
  if (snapshotStatus) {
    return snapshotStatus
  }
  const result = input.coverage.transitionResults[input.edgeId]
  if (result === 'pass' || result === 'fail') return result
  return 'untested'
}

export function getSystemMarkerFill(input: {
  status: ElementExecutionStatus
  markerKind: SystemMarkerKind
  isTesting: boolean
  renderMode: SystemRenderMode
}): string {
  if (input.renderMode === 'paper-full-system') {
    if (input.status === 'untested') return PAPER_STATUS_STROKE.untested
    return PAPER_STATUS_STROKE[input.status]
  }

  if (input.status === 'untested' && !input.isTesting) {
    if (input.markerKind === 'connector' || input.markerKind === 'variant') {
      return INTERACTIVE_IDLE_CONNECTOR
    }
    return DARK_STATUS_STROKE.untested
  }

  if (input.status === 'untested') return DARK_STATUS_STROKE.untested
  if (input.status === 'running') return DARK_STATUS_STROKE.running
  if (input.status === 'pass') return DARK_STATUS_STROKE.pass
  if (input.status === 'fail') return DARK_STATUS_STROKE.fail
  return DARK_STATUS_STROKE.untested
}

export function getSystemGraphViewBox(layout: SystemLayout, padding = 120): SystemGraphViewBox {
  if (layout.nodes.length === 0 && layout.groups.length === 0) {
    return {
      minX: 0,
      minY: 0,
      maxX: 1200,
      maxY: 800,
      width: 1200,
      height: 800,
      value: '0 0 1200 800',
    }
  }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  const includePoint = (x: number, y: number) => {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }

  layout.nodes.forEach((node) => {
    includePoint(node.x - node.width / 2, node.y - node.height / 2)
    includePoint(node.x + node.width / 2, node.y + node.height / 2)
  })

  layout.groups.forEach((group) => {
    if (group.kind === 'rect') {
      includePoint(group.cx - group.width / 2, group.cy - group.height / 2)
      includePoint(group.cx + group.width / 2, group.cy + group.height / 2)
    } else {
      includePoint(group.cx - group.radius, group.cy - group.radius)
      includePoint(group.cx + group.radius, group.cy + group.radius)
    }
    includePoint(group.labelX, group.labelY - 36)
    includePoint(group.labelX, group.labelY + 16)
  })

  layout.intraEdges.forEach((edge) => {
    edge.points.forEach((point) => includePoint(point.x, point.y))
  })

  layout.crossEdges.forEach((edge) => {
    includePoint(edge.from.x, edge.from.y)
    includePoint(edge.to.x, edge.to.y)
  })

  layout.variantEdges.forEach((edge) => {
    includePoint(edge.from.x, edge.from.y)
    includePoint(edge.to.x, edge.to.y)
  })

  const paddedMinX = Math.floor(minX - padding)
  const paddedMinY = Math.floor(minY - padding)
  const paddedMaxX = Math.ceil(maxX + padding)
  const paddedMaxY = Math.ceil(maxY + padding)
  const width = Math.max(1, paddedMaxX - paddedMinX)
  const height = Math.max(1, paddedMaxY - paddedMinY)

  return {
    minX: paddedMinX,
    minY: paddedMinY,
    maxX: paddedMaxX,
    maxY: paddedMaxY,
    width,
    height,
    value: `${paddedMinX} ${paddedMinY} ${width} ${height}`,
  }
}

export function toExportBaseFileName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'transition-system-view'
}

export function formatSnapshotTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return timestamp
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`
}
