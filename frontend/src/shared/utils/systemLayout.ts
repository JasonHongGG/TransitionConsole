import {
  forceSimulation,
  forceCenter,
  forceLink,
  forceManyBody,
  forceCollide,
  forceRadial,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3'
import type { Diagram, DiagramConnector, DiagramLayout, LayoutNode, LayoutEdge, ConnectorType } from '../types'
import { layoutDiagram, type DiagramLayoutMode } from './layout'

export type SystemLayoutMode = 'interactive' | 'paper-full-system'
export type SystemGroupKind = 'circle' | 'rect'
export type SystemGroupRow = 'pages' | 'features' | 'other'

interface SystemLayoutOptions {
  mode?: SystemLayoutMode
}

interface GroupNode extends SimulationNodeDatum {
  id: string
  name: string
  level: string
  radius: number
  width: number
  height: number
  row: SystemGroupRow
  kind: SystemGroupKind
  layout: DiagramLayout
  diagram: Diagram
}

interface GroupLink extends SimulationLinkDatum<GroupNode> {
  id: string
  type: string
  label: string
}

interface PaperCluster {
  row: SystemGroupRow
  members: GroupNode[]
  width: number
  height: number
}

export interface SystemVariantEdge {
  id: string
  baseDiagramId: string
  deltaDiagramId: string
  from: { x: number; y: number }
  to: { x: number; y: number }
  roles: string[]
}

export interface SystemNode extends LayoutNode {
  diagramId: string
}

export interface SystemIntraEdge extends LayoutEdge {
  diagramId: string
}

export interface SystemCrossEdge {
  id: string
  fromId: string
  toId: string
  fromDiagramId: string
  toDiagramId: string
  from: { x: number; y: number }
  to: { x: number; y: number }
  label: string
  type: ConnectorType
  parallelIndex: number
  parallelCount: number
  fromRow: SystemGroupRow
  toRow: SystemGroupRow
}

export interface SystemGroup {
  id: string
  name: string
  cx: number
  cy: number
  radius: number
  width: number
  height: number
  kind: SystemGroupKind
  row: SystemGroupRow
  labelX: number
  labelY: number
}

export interface SystemLayout {
  mode: SystemLayoutMode
  nodes: SystemNode[]
  intraEdges: SystemIntraEdge[]
  crossEdges: SystemCrossEdge[]
  variantEdges: SystemVariantEdge[]
  groups: SystemGroup[]
  width: number
  height: number
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
}

const PAPER_GROUP_PADDING_X = 42
const PAPER_GROUP_PADDING_Y = 28
const PAPER_CLUSTER_GAP = 88
const PAPER_DELTA_GAP = 44
const PAPER_ROW_GAP = 150
const PAPER_GROUP_LABEL_GAP = 28
const PAPER_LINE_GAP = 92
const PAPER_TARGET_ROW_WIDTH = 2700
const PAPER_MAX_CLUSTERS_PER_LINE = 4

const emptyLayout = (mode: SystemLayoutMode): SystemLayout => ({
  mode,
  nodes: [],
  intraEdges: [],
  crossEdges: [],
  variantEdges: [],
  groups: [],
  width: 0,
  height: 0,
  bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
})

const toGroupRow = (diagram: Diagram): SystemGroupRow => {
  if (diagram.level === 'page') return 'pages'
  if (diagram.level === 'feature') return 'features'
  return 'other'
}

const createGroupNodes = (diagrams: Diagram[], layoutMode: DiagramLayoutMode, mode: SystemLayoutMode): GroupNode[] =>
  diagrams.map((diagram) => {
    const layout = layoutDiagram(diagram, { mode: layoutMode })

    if (mode === 'paper-full-system') {
      const width = layout.width + PAPER_GROUP_PADDING_X * 2
      const height = layout.height + PAPER_GROUP_PADDING_Y * 2
      return {
        id: diagram.id,
        name: diagram.name,
        level: diagram.level,
        radius: Math.max(width, height) / 2,
        width,
        height,
        row: toGroupRow(diagram),
        kind: 'rect' as const,
        layout,
        diagram,
      }
    }

    const radius = Math.sqrt(layout.width ** 2 + layout.height ** 2) / 2 + 30
    return {
      id: diagram.id,
      name: diagram.name,
      level: diagram.level,
      radius,
      width: radius * 2,
      height: radius * 2,
      row: toGroupRow(diagram),
      kind: 'circle' as const,
      layout,
      diagram,
    }
  })

const placeOnRing = (nodes: GroupNode[], ringRadius: number, startAngle: number) => {
  if (nodes.length === 0) return
  const step = (Math.PI * 2) / nodes.length
  nodes.forEach((node, index) => {
    const angle = startAngle + index * step
    node.x = Math.cos(angle) * ringRadius
    node.y = Math.sin(angle) * ringRadius
  })
}

const buildGroupInfo = (groups: GroupNode[], mode: SystemLayoutMode): SystemGroup[] =>
  groups.map((group) => ({
    id: group.id,
    name: group.name,
    cx: group.x ?? 0,
    cy: group.y ?? 0,
    radius: group.radius,
    width: group.width,
    height: group.height,
    kind: group.kind,
    row: group.row,
    labelX: group.x ?? 0,
    labelY:
      mode === 'paper-full-system'
        ? (group.y ?? 0) - group.height / 2 - PAPER_GROUP_LABEL_GAP
        : (group.y ?? 0) - group.radius - 8,
  }))

const computeVariantEdges = (diagrams: Diagram[], groupInfo: SystemGroup[]): SystemVariantEdge[] => {
  const groupPositions = new Map(groupInfo.map((group) => [group.id, { x: group.cx, y: group.cy }]))
  return diagrams
    .filter((diagram) => diagram.variant.kind === 'delta' && diagram.variant.baseDiagramId)
    .map((diagram) => {
      const baseDiagramId = diagram.variant.baseDiagramId
      if (!baseDiagramId) return null
      const from = groupPositions.get(baseDiagramId)
      const to = groupPositions.get(diagram.id)
      if (!from || !to) return null
      return {
        id: `v.${baseDiagramId}.extends.${diagram.id}`,
        baseDiagramId,
        deltaDiagramId: diagram.id,
        from,
        to,
        roles: diagram.variant.appliesToRoles,
      }
    })
    .filter((edge): edge is SystemVariantEdge => edge !== null)
}

const computeRawCrossEdges = (
  connectors: DiagramConnector[],
  diagramIdSet: Set<string>,
  nodePositions: Map<string, { x: number; y: number }>,
  groupById: Map<string, GroupNode>,
): SystemCrossEdge[] =>
  connectors
    .filter((connector) => connector.type === 'invokes')
    .filter((connector) => diagramIdSet.has(connector.from.diagramId) && diagramIdSet.has(connector.to.diagramId))
    .map((connector) => {
      const fromStateId = connector.from.stateId
      const toStateId = connector.to.stateId
      if (!fromStateId || !toStateId) return null
      const from = nodePositions.get(fromStateId)
      const to = nodePositions.get(toStateId)
      const fromGroup = groupById.get(connector.from.diagramId)
      const toGroup = groupById.get(connector.to.diagramId)
      if (!from || !to || !fromGroup || !toGroup) return null

      return {
        id: connector.id,
        fromId: fromStateId,
        toId: toStateId,
        fromDiagramId: connector.from.diagramId,
        toDiagramId: connector.to.diagramId,
        from,
        to,
        label: connector.meta.reason,
        type: connector.type,
        parallelIndex: 0,
        parallelCount: 1,
        fromRow: fromGroup.row,
        toRow: toGroup.row,
      }
    })
    .filter((edge): edge is SystemCrossEdge => edge !== null)

const assignParallelEdgeLanes = (edges: SystemCrossEdge[]): SystemCrossEdge[] => {
  const pairGroups = new Map<string, SystemCrossEdge[]>()
  edges.forEach((edge) => {
    const key = `${edge.fromId}=>${edge.toId}`
    const bucket = pairGroups.get(key)
    if (bucket) {
      bucket.push(edge)
    } else {
      pairGroups.set(key, [edge])
    }
  })

  const crossEdges: SystemCrossEdge[] = []
  pairGroups.forEach((bucket) => {
    const total = bucket.length
    bucket.forEach((edge, index) => {
      crossEdges.push({
        ...edge,
        parallelIndex: index,
        parallelCount: total,
      })
    })
  })

  return crossEdges
}

const computeBounds = (layout: Pick<SystemLayout, 'nodes' | 'groups' | 'crossEdges' | 'variantEdges' | 'intraEdges'>) => {
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
    includePoint(group.labelX, group.labelY - 28)
    includePoint(group.labelX, group.labelY + 12)
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

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 }
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

const computeInteractiveSystemLayout = (diagrams: Diagram[], connectors: DiagramConnector[]): SystemLayout => {
  const groups = createGroupNodes(diagrams, 'interactive', 'interactive')
  if (groups.length === 0) {
    return emptyLayout('interactive')
  }

  const groupById = new Map(groups.map((group) => [group.id, group]))
  const diagramIdSet = new Set(diagrams.map((diagram) => diagram.id))
  const renderConnectors = connectors.filter((connector) => connector.type === 'invokes')

  const nonDeltaPages = groups.filter((group) => group.level === 'page' && group.diagram.variant.kind !== 'delta')
  const nonDeltaFeatures = groups.filter((group) => group.level === 'feature' && group.diagram.variant.kind !== 'delta')

  placeOnRing(nonDeltaPages, 260, -Math.PI / 2)
  placeOnRing(nonDeltaFeatures, 520, -Math.PI / 2)

  const deltaByBase = new Map<string, GroupNode[]>()
  groups
    .filter((group) => group.diagram.variant.kind === 'delta' && group.diagram.variant.baseDiagramId)
    .forEach((delta) => {
      const baseId = delta.diagram.variant.baseDiagramId as string
      const bucket = deltaByBase.get(baseId)
      if (bucket) {
        bucket.push(delta)
      } else {
        deltaByBase.set(baseId, [delta])
      }
    })

  deltaByBase.forEach((deltas, baseId) => {
    const base = groupById.get(baseId)
    if (!base) return
    const bx = base.x ?? 0
    const by = base.y ?? 0
    const spread = Math.max(1, deltas.length)
    deltas.forEach((delta, index) => {
      const centered = index - (spread - 1) / 2
      const angle = -Math.PI / 8 + centered * (Math.PI / 8)
      const distance = base.radius * 0.75 + delta.radius * 0.75 + 24
      delta.x = bx + Math.cos(angle) * distance
      delta.y = by + Math.sin(angle) * distance
    })
  })

  groups.forEach((group, index) => {
    if (group.x !== undefined && group.y !== undefined) return
    const angle = -Math.PI / 2 + index * 0.55
    const radius = group.level === 'page' ? 260 : 520
    group.x = Math.cos(angle) * radius
    group.y = Math.sin(angle) * radius
  })

  const seen = new Set<string>()
  const links: GroupLink[] = renderConnectors
    .filter((connector) => diagramIdSet.has(connector.from.diagramId) && diagramIdSet.has(connector.to.diagramId))
    .filter((connector) => {
      const key = [connector.from.diagramId, connector.to.diagramId].sort().join('|')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((connector) => ({
      source: connector.from.diagramId,
      target: connector.to.diagramId,
      id: connector.id,
      type: connector.type,
      label: connector.meta.reason,
    }))

  const variantLinks: GroupLink[] = diagrams
    .filter((diagram) => diagram.variant.kind === 'delta' && diagram.variant.baseDiagramId)
    .map((diagram) => ({
      source: diagram.variant.baseDiagramId as string,
      target: diagram.id,
      id: `variant-link.${diagram.variant.baseDiagramId}.${diagram.id}`,
      type: 'variant',
      label: 'extends',
    }))
    .filter((link) => diagramIdSet.has(link.source as string) && diagramIdSet.has(link.target as string))

  const simulation = forceSimulation<GroupNode>(groups)
    .force('center', forceCenter(0, 0).strength(0.05))
    .force('charge', forceManyBody<GroupNode>().strength(-1200))
    .force(
      'collide',
      forceCollide<GroupNode>().radius((group) => group.radius + 20).strength(0.8),
    )
    .force(
      'link',
      forceLink<GroupNode, GroupLink>(links)
        .id((group) => group.id)
        .distance((link) => {
          const source = link.source as GroupNode
          const target = link.target as GroupNode
          return source.radius + target.radius + 60
        })
        .strength(0.4),
    )
    .force(
      'variantLink',
      forceLink<GroupNode, GroupLink>(variantLinks)
        .id((group) => group.id)
        .distance((link) => {
          const source = link.source as GroupNode
          const target = link.target as GroupNode
          return source.radius + target.radius + 18
        })
        .strength(0.95),
    )
    .force(
      'radial',
      forceRadial<GroupNode>((group) => (group.level === 'page' ? 250 : 500), 0, 0).strength(0.15),
    )
    .stop()

  for (let i = 0; i < 300; i += 1) {
    simulation.tick()
  }

  const allNodes: SystemNode[] = []
  const allIntraEdges: SystemIntraEdge[] = []
  const nodePositions = new Map<string, { x: number; y: number }>()

  groups.forEach((group) => {
    const cx = group.x ?? 0
    const cy = group.y ?? 0
    const layout = group.layout
    const layoutCenterX = (layout.bounds.minX + layout.bounds.maxX) / 2
    const layoutCenterY = (layout.bounds.minY + layout.bounds.maxY) / 2

    layout.nodes.forEach((node) => {
      const fx = cx + (node.x - layoutCenterX)
      const fy = cy + (node.y - layoutCenterY)
      allNodes.push({ ...node, x: fx, y: fy, diagramId: group.id })
      nodePositions.set(node.id, { x: fx, y: fy })
    })

    layout.edges.forEach((edge) => {
      allIntraEdges.push({
        ...edge,
        points: edge.points.map((point) => ({
          x: cx + (point.x - layoutCenterX),
          y: cy + (point.y - layoutCenterY),
        })),
        diagramId: group.id,
      })
    })
  })

  const crossEdges = assignParallelEdgeLanes(computeRawCrossEdges(connectors, diagramIdSet, nodePositions, groupById))
  const groupInfo = buildGroupInfo(groups, 'interactive')
  const variantEdges = computeVariantEdges(diagrams, groupInfo)
  const bounds = computeBounds({ nodes: allNodes, intraEdges: allIntraEdges, crossEdges, variantEdges, groups: groupInfo })

  return {
    mode: 'interactive',
    nodes: allNodes,
    intraEdges: allIntraEdges,
    crossEdges,
    variantEdges,
    groups: groupInfo,
    width: bounds.width,
    height: bounds.height,
    bounds: { minX: bounds.minX, maxX: bounds.maxX, minY: bounds.minY, maxY: bounds.maxY },
  }
}

const buildPaperClusters = (groups: GroupNode[]) => {
  const orderedGroups = groups.slice()
  const groupById = new Map(orderedGroups.map((group) => [group.id, group]))
  const deltasByBase = new Map<string, GroupNode[]>()

  orderedGroups
    .filter((group) => group.diagram.variant.kind === 'delta' && group.diagram.variant.baseDiagramId)
    .forEach((group) => {
      const baseId = group.diagram.variant.baseDiagramId as string
      const bucket = deltasByBase.get(baseId)
      if (bucket) {
        bucket.push(group)
      } else {
        deltasByBase.set(baseId, [group])
      }
    })

  const assignedDeltaIds = new Set<string>()
  const createCluster = (members: GroupNode[], row: SystemGroupRow): PaperCluster => ({
    row,
    members,
    width: members.reduce((sum, member, index) => sum + member.width + (index === 0 ? 0 : PAPER_DELTA_GAP), 0),
    height: members.reduce((max, member) => Math.max(max, member.height), 0),
  })

  const pageClusters: PaperCluster[] = []
  const featureClusters: PaperCluster[] = []
  const otherClusters: PaperCluster[] = []

  const pushCluster = (cluster: PaperCluster) => {
    if (cluster.row === 'pages') {
      pageClusters.push(cluster)
    } else if (cluster.row === 'features') {
      featureClusters.push(cluster)
    } else {
      otherClusters.push(cluster)
    }
  }

  orderedGroups
    .filter((group) => group.diagram.variant.kind !== 'delta')
    .forEach((baseGroup) => {
      const members = [baseGroup, ...(deltasByBase.get(baseGroup.id) ?? [])]
      members.slice(1).forEach((member) => assignedDeltaIds.add(member.id))
      pushCluster(createCluster(members, baseGroup.row))
    })

  orderedGroups
    .filter((group) => group.diagram.variant.kind === 'delta' && !assignedDeltaIds.has(group.id))
    .forEach((orphanDelta) => {
      const base = orphanDelta.diagram.variant.baseDiagramId ? groupById.get(orphanDelta.diagram.variant.baseDiagramId) : null
      pushCluster(createCluster([orphanDelta], base?.row ?? orphanDelta.row))
    })

  return { pageClusters, featureClusters, otherClusters }
}

const wrapPaperClusters = (clusters: PaperCluster[]) => {
  if (clusters.length === 0) {
    return [] as PaperCluster[][]
  }

  const lines: PaperCluster[][] = []
  let currentLine: PaperCluster[] = []
  let currentWidth = 0

  clusters.forEach((cluster) => {
    const nextWidth = currentLine.length === 0 ? cluster.width : currentWidth + PAPER_CLUSTER_GAP + cluster.width
    const lineIsFull = currentLine.length >= PAPER_MAX_CLUSTERS_PER_LINE
    const lineWouldOverflow = currentLine.length > 0 && nextWidth > PAPER_TARGET_ROW_WIDTH

    if (lineIsFull || lineWouldOverflow) {
      lines.push(currentLine)
      currentLine = [cluster]
      currentWidth = cluster.width
      return
    }

    currentLine.push(cluster)
    currentWidth = nextWidth
  })

  if (currentLine.length > 0) {
    lines.push(currentLine)
  }

  return lines
}

const assignPaperRowPositions = (clusters: PaperCluster[], rowTop: number) => {
  if (clusters.length === 0) {
    return { rowWidth: 0, rowHeight: 0 }
  }

  const rowWidth = clusters.reduce((sum, cluster, index) => sum + cluster.width + (index === 0 ? 0 : PAPER_CLUSTER_GAP), 0)
  const rowHeight = clusters.reduce((max, cluster) => Math.max(max, cluster.height), 0)
  let cursorX = -rowWidth / 2

  clusters.forEach((cluster) => {
    let memberX = cursorX
    cluster.members.forEach((member) => {
      member.x = memberX + member.width / 2
      member.y = rowTop + rowHeight / 2
      memberX += member.width + PAPER_DELTA_GAP
    })
    cursorX += cluster.width + PAPER_CLUSTER_GAP
  })

  return { rowWidth, rowHeight }
}

const assignPaperLinePositions = (lines: PaperCluster[][], startTop: number) => {
  if (lines.length === 0) {
    return { width: 0, height: 0, nextTop: startTop }
  }

  let cursorTop = startTop
  let maxWidth = 0

  lines.forEach((line) => {
    const { rowWidth, rowHeight } = assignPaperRowPositions(line, cursorTop)
    maxWidth = Math.max(maxWidth, rowWidth)
    cursorTop += rowHeight + PAPER_LINE_GAP
  })

  return {
    width: maxWidth,
    height: cursorTop - startTop - PAPER_LINE_GAP,
    nextTop: cursorTop - PAPER_LINE_GAP,
  }
}

const computePaperSystemLayout = (diagrams: Diagram[], connectors: DiagramConnector[]): SystemLayout => {
  const groups = createGroupNodes(diagrams, 'paper-full-system', 'paper-full-system')
  if (groups.length === 0) {
    return emptyLayout('paper-full-system')
  }

  const { pageClusters, featureClusters, otherClusters } = buildPaperClusters(groups)
  const pageSection = assignPaperLinePositions(wrapPaperClusters(pageClusters), 0)
  const featureRowTop = pageSection.height === 0 ? 0 : pageSection.nextTop + PAPER_ROW_GAP
  const featureSection = assignPaperLinePositions(wrapPaperClusters(featureClusters), featureRowTop)
  const otherRowTop = featureSection.height === 0 ? featureRowTop : featureSection.nextTop + PAPER_ROW_GAP
  assignPaperLinePositions(wrapPaperClusters(otherClusters), otherRowTop)

  const groupById = new Map(groups.map((group) => [group.id, group]))
  const allNodes: SystemNode[] = []
  const allIntraEdges: SystemIntraEdge[] = []
  const nodePositions = new Map<string, { x: number; y: number }>()

  groups.forEach((group) => {
    const originX = (group.x ?? 0) - group.width / 2 + PAPER_GROUP_PADDING_X
    const originY = (group.y ?? 0) - group.height / 2 + PAPER_GROUP_PADDING_Y
    const layout = group.layout

    layout.nodes.forEach((node) => {
      const fx = originX + (node.x - layout.bounds.minX)
      const fy = originY + (node.y - layout.bounds.minY)
      allNodes.push({ ...node, x: fx, y: fy, diagramId: group.id })
      nodePositions.set(node.id, { x: fx, y: fy })
    })

    layout.edges.forEach((edge) => {
      allIntraEdges.push({
        ...edge,
        points: edge.points.map((point) => ({
          x: originX + (point.x - layout.bounds.minX),
          y: originY + (point.y - layout.bounds.minY),
        })),
        diagramId: group.id,
      })
    })
  })

  const diagramIdSet = new Set(diagrams.map((diagram) => diagram.id))
  const crossEdges = assignParallelEdgeLanes(computeRawCrossEdges(connectors, diagramIdSet, nodePositions, groupById))
  const groupInfo = buildGroupInfo(groups, 'paper-full-system')
  const variantEdges: SystemVariantEdge[] = []
  const bounds = computeBounds({ nodes: allNodes, intraEdges: allIntraEdges, crossEdges, variantEdges, groups: groupInfo })

  return {
    mode: 'paper-full-system',
    nodes: allNodes,
    intraEdges: allIntraEdges,
    crossEdges,
    variantEdges,
    groups: groupInfo,
    width: bounds.width,
    height: bounds.height,
    bounds: { minX: bounds.minX, maxX: bounds.maxX, minY: bounds.minY, maxY: bounds.maxY },
  }
}

export function computeSystemLayout(
  diagrams: Diagram[],
  connectors: DiagramConnector[],
  options: SystemLayoutOptions = {},
): SystemLayout {
  const mode = options.mode ?? 'interactive'
  if (diagrams.length === 0) {
    return emptyLayout(mode)
  }

  if (mode === 'paper-full-system') {
    return computePaperSystemLayout(diagrams, connectors)
  }

  return computeInteractiveSystemLayout(diagrams, connectors)
}
