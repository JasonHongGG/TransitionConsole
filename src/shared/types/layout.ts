import type { StateType } from './diagram'

export interface LayoutNode {
  id: string
  label: string
  x: number
  y: number
  width: number
  height: number
  type: StateType
}

export interface LayoutEdge {
  id: string
  from: string
  to: string
  points: Array<{ x: number; y: number }>
  label: string | null
}

export interface DiagramLayout {
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  width: number
  height: number
  bounds: {
    minX: number
    maxX: number
    minY: number
    maxY: number
  }
}
