import dagre from 'dagre'
import type { Diagram, DiagramLayout } from '../types'

const NODE_WIDTH = 140
const NODE_HEIGHT = 44

export const layoutDiagram = (diagram: Diagram): DiagramLayout => {
  if (diagram.states.length === 0) {
    return {
      nodes: [],
      edges: [],
      width: 200,
      height: 200,
      bounds: {
        minX: 0,
        maxX: 0,
        minY: 0,
        maxY: 0,
      },
    }
  }

  const graph = new dagre.graphlib.Graph()
  graph.setGraph({ rankdir: 'LR', nodesep: 56, ranksep: 80, marginx: 20, marginy: 20 })
  graph.setDefaultEdgeLabel(() => ({}))

  diagram.states.forEach((state) => {
    graph.setNode(state.id, {
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      label: state.label,
      type: state.type,
    })
  })

  diagram.transitions.forEach((transition) => {
    graph.setEdge(transition.from, transition.to, { label: transition.event ?? '' })
  })

  dagre.layout(graph)

  const nodes = diagram.states.map((state) => {
    const node = graph.node(state.id)
    return {
      id: state.id,
      label: state.label,
      x: node?.x ?? 0,
      y: node?.y ?? 0,
      width: node?.width ?? NODE_WIDTH,
      height: node?.height ?? NODE_HEIGHT,
      type: state.type,
    }
  })

  const edges = diagram.transitions.map((transition) => {
    const edge = graph.edge({ v: transition.from, w: transition.to })
    return {
      id: transition.id,
      from: transition.from,
      to: transition.to,
      points: edge?.points ?? [],
      label: transition.event ?? null,
    }
  })

  const bounds = nodes.reduce(
    (acc, node) => {
      const minX = Math.min(acc.minX, node.x - node.width / 2)
      const maxX = Math.max(acc.maxX, node.x + node.width / 2)
      const minY = Math.min(acc.minY, node.y - node.height / 2)
      const maxY = Math.max(acc.maxY, node.y + node.height / 2)
      return { minX, maxX, minY, maxY }
    },
    {
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  )

  const width = Math.max(200, bounds.maxX - bounds.minX + 40)
  const height = Math.max(200, bounds.maxY - bounds.minY + 40)

  return {
    nodes,
    edges,
    width,
    height,
    bounds,
  }
}
