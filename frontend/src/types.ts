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

export const KIND_COLORS: Record<NodeKind, string> = {
  paper: '#34d399', // emerald-400
  concept: '#fbbf24', // amber-400
  model: '#f87171', // red-400
  dataset: '#22d3ee', // cyan-400
}

/** Resolve a link endpoint to a node id whether it's a string or a node object. */
export function endpointId(end: string | GraphNode): string {
  return typeof end === 'string' ? end : end.id
}
