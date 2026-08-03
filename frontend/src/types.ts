export type NodeKind = 'paper' | 'concept' | 'model' | 'dataset'

export interface GraphNode {
  id: string
  kind: NodeKind
  name: string
  status: string
  first_seen: string
  val: number
  meta: Record<string, unknown>
  // react-force-graph adds x/y/vx/vy at runtime
  x?: number
  y?: number
}

export interface GraphLink {
  source: string | GraphNode
  target: string | GraphNode
  relation: string
  weight: number
  status: string
}

export interface GraphData {
  nodes: GraphNode[]
  links: GraphLink[]
}

/** Knoten-Farben je Theme — paper trägt das Markenblau (primary). */
export const KIND_COLORS: Record<'light' | 'dark', Record<NodeKind, string>> = {
  light: {
    paper: '#2563eb', // primary-600
    concept: '#d97706', // amber-600
    model: '#dc2626', // red-600
    // violett statt cyan: neben dem blauen paper-Knoten sonst nicht unterscheidbar
    dataset: '#7c3aed', // violet-600
  },
  dark: {
    paper: '#60a5fa', // primary-400
    concept: '#fbbf24', // amber-400
    model: '#f87171', // red-400
    dataset: '#a78bfa', // violet-400
  },
}

/** Resolve a link endpoint to a node id whether it's a string or a node object. */
export function endpointId(end: string | GraphNode): string {
  return typeof end === 'string' ? end : end.id
}
