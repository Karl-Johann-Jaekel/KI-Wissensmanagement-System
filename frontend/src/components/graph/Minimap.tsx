/**
 * Minimap: Übersicht aller Knoten plus aktueller Bildausschnitt. Liest die
 * Positionen direkt aus den Szenen-Knoten (force-graph mutiert sie live) und
 * zeichnet gedrosselt — ein React-Render pro Frame wäre unnötige Last.
 */
import { useCallback, useEffect, useRef } from 'react'
import { FALLBACK_COLOR } from '../../types'
import type { Scene, Theme } from './scene'

interface Props {
  scene: Scene
  /** force-graph-Instanz (screen2GraphCoords, centerAt). */
  fg: any
  /** Größe des Graph-Canvas — für die Ausschnitt-Berechnung. */
  graphWidth: number
  graphHeight: number
  theme: Theme
}

const WIDTH = 148
const HEIGHT = 108
const PADDING = 6
const FRAME_MS = 66

export default function Minimap({ scene, fg, graphWidth, graphHeight, theme }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewRef = useRef({ scale: 1, ox: 0, oy: 0 })

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const n of scene.nodes) {
      if (n.x === undefined || n.y === undefined) continue
      minX = Math.min(minX, n.x)
      maxX = Math.max(maxX, n.x)
      minY = Math.min(minY, n.y)
      maxY = Math.max(maxY, n.y)
    }
    if (!Number.isFinite(minX)) return

    const spanX = Math.max(1, maxX - minX)
    const spanY = Math.max(1, maxY - minY)
    const scale = Math.min((WIDTH - 2 * PADDING) / spanX, (HEIGHT - 2 * PADDING) / spanY)
    const ox = (WIDTH - spanX * scale) / 2 - minX * scale
    const oy = (HEIGHT - spanY * scale) / 2 - minY * scale
    viewRef.current = { scale, ox, oy }

    ctx.clearRect(0, 0, WIDTH, HEIGHT)
    const colors = new Map(scene.groups.map((g) => [g.id, g.color]))
    for (const n of scene.nodes) {
      if (n.x === undefined || n.y === undefined) continue
      ctx.fillStyle = colors.get(n.group) ?? FALLBACK_COLOR[theme]
      ctx.globalAlpha = 0.85
      const r = n.members || n.kind === 'system' ? 2.4 : 1.2
      ctx.beginPath()
      ctx.arc(n.x * scale + ox, n.y * scale + oy, r, 0, 2 * Math.PI)
      ctx.fill()
    }

    // Aktueller Ausschnitt als Rahmen.
    if (fg && graphWidth > 0) {
      try {
        const tl = fg.screen2GraphCoords(0, 0)
        const br = fg.screen2GraphCoords(graphWidth, graphHeight)
        ctx.globalAlpha = 1
        ctx.strokeStyle = theme === 'dark' ? 'rgba(226,232,240,0.7)' : 'rgba(15,23,42,0.6)'
        ctx.lineWidth = 1
        ctx.strokeRect(
          tl.x * scale + ox,
          tl.y * scale + oy,
          (br.x - tl.x) * scale,
          (br.y - tl.y) * scale,
        )
      } catch {
        // Instanz noch nicht bereit — nächster Frame zeichnet den Rahmen.
      }
    }
    ctx.globalAlpha = 1
  }, [scene, fg, graphWidth, graphHeight, theme])

  useEffect(() => {
    let raf = 0
    let last = 0
    const loop = (now: number) => {
      if (now - last >= FRAME_MS) {
        last = now
        draw()
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [draw])

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const { scale, ox, oy } = viewRef.current
    fg?.centerAt((e.clientX - rect.left - ox) / scale, (e.clientY - rect.top - oy) / scale, 500)
  }

  return (
    <canvas
      ref={canvasRef}
      width={WIDTH}
      height={HEIGHT}
      onClick={onClick}
      title="Klick zentriert die Ansicht"
      className="absolute bottom-3 left-3 z-20 hidden cursor-pointer rounded-lg border border-edge bg-surface/80 shadow-lg backdrop-blur sm:block"
    />
  )
}
