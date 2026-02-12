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
import { layoutDiagram } from './layout'

/* ───────── Types ───────── */

interface GroupNode extends SimulationNodeDatum {
    id: string
    name: string
    level: string
    radius: number
    layout: DiagramLayout
    diagram: Diagram
}

interface GroupLink extends SimulationLinkDatum<GroupNode> {
    id: string
    type: string
    label: string
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
    from: { x: number; y: number }
    to: { x: number; y: number }
    label: string
    type: ConnectorType
}

export interface SystemGroup {
    id: string
    name: string
    cx: number
    cy: number
    radius: number
}

export interface SystemLayout {
    nodes: SystemNode[]
    intraEdges: SystemIntraEdge[]
    crossEdges: SystemCrossEdge[]
    variantEdges: SystemVariantEdge[]
    groups: SystemGroup[]
    width: number
    height: number
    bounds: { minX: number; maxX: number; minY: number; maxY: number }
}

/* ───────── Layout function ───────── */

export function computeSystemLayout(
    diagrams: Diagram[],
    connectors: DiagramConnector[],
): SystemLayout {
    if (diagrams.length === 0) {
        return {
            nodes: [],
            intraEdges: [],
            crossEdges: [],
            variantEdges: [],
            groups: [],
            width: 0,
            height: 0,
            bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
        }
    }

    // 1. Layout each diagram individually via dagre
    const groups: GroupNode[] = diagrams.map((diagram) => {
        const layout = layoutDiagram(diagram)
        const radius = Math.sqrt(layout.width ** 2 + layout.height ** 2) / 2 + 30
        return {
            id: diagram.id,
            name: diagram.name,
            level: diagram.level,
            radius,
            layout,
            diagram,
        }
    })

    const diagramIdSet = new Set(diagrams.map((d) => d.id))

    // 2. Build links for force simulation (deduplicate per pair)
    const seen = new Set<string>()
    const links: GroupLink[] = connectors
        .filter((c) => diagramIdSet.has(c.from.diagramId) && diagramIdSet.has(c.to.diagramId))
        .filter((c) => {
            const key = [c.from.diagramId, c.to.diagramId].sort().join('|')
            if (seen.has(key)) return false
            seen.add(key)
            return true
        })
        .map((c) => ({
            source: c.from.diagramId,
            target: c.to.diagramId,
            id: c.id,
            type: c.type,
            label: c.meta.reason,
        }))

    // 3. Run force simulation
    const simulation = forceSimulation<GroupNode>(groups)
        .force('center', forceCenter(0, 0).strength(0.05))
        .force('charge', forceManyBody<GroupNode>().strength(-1200))
        .force(
            'collide',
            forceCollide<GroupNode>().radius((d) => d.radius + 20).strength(0.8),
        )
        .force(
            'link',
            forceLink<GroupNode, GroupLink>(links)
                .id((d) => d.id)
                .distance((d) => {
                    const s = d.source as GroupNode
                    const t = d.target as GroupNode
                    return s.radius + t.radius + 60
                })
                .strength(0.4),
        )
        .force(
            'radial',
            forceRadial<GroupNode>(
                (d) => (d.level === 'page' ? 250 : 500),
                0,
                0,
            ).strength(0.15),
        )
        .stop()

    // Tick to convergence
    for (let i = 0; i < 300; i++) simulation.tick()

    // 4. Compute final node/edge positions
    const allNodes: SystemNode[] = []
    const allIntraEdges: SystemIntraEdge[] = []
    const groupInfo: SystemGroup[] = []
    const nodePositions = new Map<string, { x: number; y: number }>()

    groups.forEach((group) => {
        const cx = group.x ?? 0
        const cy = group.y ?? 0
        const layout = group.layout
        const lCx = (layout.bounds.minX + layout.bounds.maxX) / 2
        const lCy = (layout.bounds.minY + layout.bounds.maxY) / 2

        groupInfo.push({ id: group.id, name: group.name, cx, cy, radius: group.radius })

        layout.nodes.forEach((node) => {
            const fx = cx + (node.x - lCx)
            const fy = cy + (node.y - lCy)
            allNodes.push({ ...node, x: fx, y: fy, diagramId: group.id })
            nodePositions.set(node.id, { x: fx, y: fy })
        })

        layout.edges.forEach((edge) => {
            allIntraEdges.push({
                ...edge,
                points: edge.points.map((p) => ({
                    x: cx + (p.x - lCx),
                    y: cy + (p.y - lCy),
                })),
                diagramId: group.id,
            })
        })
    })

    // 5. Compute cross-diagram edges (connect explicit connector endpoints)
    const crossEdges: SystemCrossEdge[] = connectors
        .filter((c) => diagramIdSet.has(c.from.diagramId) && diagramIdSet.has(c.to.diagramId))
        .map((connector) => {
            const fromStateId = connector.from.stateId
            const toStateId = connector.to.stateId
            if (!fromStateId || !toStateId) return null
            const from = nodePositions.get(fromStateId)
            const to = nodePositions.get(toStateId)
            if (!from || !to) return null

            return {
                id: connector.id,
                fromId: fromStateId,
                toId: toStateId,
                from,
                to,
                label: connector.meta.reason,
                type: connector.type,
            }
        })
        .filter((e): e is SystemCrossEdge => e !== null)

    // 6. Compute base/delta variant edges
    const groupPositions = new Map(groupInfo.map((group) => [group.id, { x: group.cx, y: group.cy }]))
    const variantEdges: SystemVariantEdge[] = diagrams
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

    // 7. Compute bounds
    let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity
    allNodes.forEach((n) => {
        minX = Math.min(minX, n.x - n.width / 2)
        maxX = Math.max(maxX, n.x + n.width / 2)
        minY = Math.min(minY, n.y - n.height / 2)
        maxY = Math.max(maxY, n.y + n.height / 2)
    })

    return {
        nodes: allNodes,
        intraEdges: allIntraEdges,
        crossEdges,
        variantEdges,
        groups: groupInfo,
        width: maxX - minX,
        height: maxY - minY,
        bounds: { minX, maxX, minY, maxY },
    }
}
