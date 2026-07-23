import { useCallback, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { endpointId, KIND_COLORS, type GraphData, type GraphNode } from '../types'

interface Props {
  data: GraphData
  width: number
  height: number
  /** Node ids to keep bright; null = all bright (no filter). */
  activeIds: Set<string> | null
  onNodeClick: (node: GraphNode) => void
  selectedId: string | null
}

const DIM_ALPHA = 0.12

export default function GraphView({
  data,
  width,
  height,
  activeIds,
  onNodeClick,
  selectedId,
}: Props) {
  const fgRef = useRef<any>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)

  // adjacency for hover-neighbour highlighting
  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const n of data.nodes) map.set(n.id, new Set())
    for (const l of data.links) {
      const s = endpointId(l.source)
      const t = endpointId(l.target)
      map.get(s)?.add(t)
      map.get(t)?.add(s)
    }
    return map
  }, [data])

  const isInFilter = useCallback(
    (id: string) => activeIds === null || activeIds.has(id),
    [activeIds],
  )
  const isInHover = useCallback(
    (id: string) => hoverId === null || id === hoverId || !!neighbours.get(hoverId)?.has(id),
    [hoverId, neighbours],
  )
  const isBright = useCallback(
    (id: string) => isInFilter(id) && isInHover(id),
    [isInFilter, isInHover],
  )

  const paintNode = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D, scale: number) => {
      const bright = isBright(node.id)
      const r = 2 + Math.sqrt(node.val) * 1.6
      const color = KIND_COLORS[node.kind] ?? '#94a3b8'
      ctx.globalAlpha = bright ? 1 : DIM_ALPHA
      ctx.beginPath()
      ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI)
      ctx.fillStyle = color
      ctx.fill()
      if (node.id === selectedId) {
        ctx.lineWidth = 2 / scale
        ctx.strokeStyle = '#ffffff'
        ctx.stroke()
      }
      // labels: papers always; others when zoomed in or bright
      const showLabel = node.kind === 'paper' || (bright && scale > 1.3)
      if (showLabel && bright) {
        const fontSize = Math.max(3, 11 / scale)
        ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`
        ctx.fillStyle = '#e2e8f0'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillText(node.name, node.x ?? 0, (node.y ?? 0) + r + 1)
      }
      ctx.globalAlpha = 1
    },
    [isBright, selectedId],
  )

  const paintPointerArea = useCallback(
    (node: GraphNode, color: string, ctx: CanvasRenderingContext2D) => {
      const r = 2 + Math.sqrt(node.val) * 1.6
      ctx.beginPath()
      ctx.arc(node.x ?? 0, node.y ?? 0, r + 2, 0, 2 * Math.PI)
      ctx.fillStyle = color
      ctx.fill()
    },
    [],
  )

  const linkColor = useCallback(
    (l: GraphData['links'][number]) => {
      const s = endpointId(l.source)
      const t = endpointId(l.target)
      const inFilter = activeIds === null || (activeIds.has(s) && activeIds.has(t))
      const inHover = hoverId === null || s === hoverId || t === hoverId
      if (inFilter && inHover && hoverId !== null && (s === hoverId || t === hoverId))
        return 'rgba(226,232,240,0.9)'
      return inFilter && inHover ? 'rgba(148,163,184,0.35)' : 'rgba(148,163,184,0.05)'
    },
    [activeIds, hoverId],
  )

  return (
    <ForceGraph2D
      ref={fgRef}
      graphData={data}
      width={width}
      height={height}
      backgroundColor="#020617"
      nodeVal={(n: GraphNode) => n.val}
      nodeLabel={(n: GraphNode) => `${n.kind}: ${n.name}`}
      nodeCanvasObject={paintNode}
      nodePointerAreaPaint={paintPointerArea}
      linkColor={linkColor}
      linkWidth={(l: GraphData['links'][number]) => 0.5 + l.weight * 1.5}
      linkDirectionalParticles={0}
      onNodeHover={(n: GraphNode | null) => setHoverId(n ? n.id : null)}
      onNodeClick={(n: GraphNode) => onNodeClick(n)}
      cooldownTicks={120}
    />
  )
}
