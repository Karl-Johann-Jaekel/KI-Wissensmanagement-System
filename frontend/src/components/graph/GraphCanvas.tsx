/**
 * Canvas des Graph-Explorers.
 *
 * force-graph liefert Kamera, Treffererkennung und die Kräftesimulation für die
 * Wolken-Ansicht; die strukturierten Layouts (Globus/Ring/Ebenen) positionieren wir
 * selbst in `onRenderFramePre` und ziehen die Knoten weich auf ihr Ziel — dadurch
 * sind Layout-Wechsel animiert und die Kugeln bleiben trotzdem in Bewegung.
 */
import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { FALLBACK_COLOR, LANDMARK_COLOR } from '../../types'
import {
  clusterCenters,
  globeBasis,
  globeFrame,
  layoutTargets,
  ringGeometry,
  tierLabelPositions,
  type Target,
} from './layouts'
import {
  endpoint,
  SCENE_COLORS,
  TIER_LABELS,
  type Scene,
  type SceneLink,
  type SceneNode,
  type Theme,
} from './scene'
import type { GraphSettings } from './settings'
import { boundsOf, fitTransform } from './viewport'

interface Props {
  scene: Scene
  width: number
  height: number
  /**
   * Vom Bedienmenü belegte Bildpunkte am rechten Rand. Die Kamera passt den
   * Graphen in die Fläche *daneben* ein, statt ihn teilweise darunter zu legen.
   */
  insetRight?: number
  settings: GraphSettings
  theme: Theme
  /** Suchtreffer; null = kein Filter. */
  activeIds: Set<string> | null
  selectedId: string | null
  /** Knoten, auf den die Kamera springen soll (nonce erzwingt Wiederholung). */
  focus: { id: string; nonce: number } | null
  onNodeClick: (node: SceneNode) => void
  onBackgroundClick: () => void
  onHover?: (node: SceneNode | null) => void
  onInstance?: (fg: unknown | null) => void
  /** Rotation und Drift anhalten (z. B. während ein Knoten ausgewählt ist). */
  paused?: boolean
  /**
   * Manueller Dreh-Offset (Radiant), von außen gesetzt — etwa durch Ziehen auf der
   * Minimap. Ein Ref statt eines Props: Ändert sich pro Mausbewegung, ein State
   * würde bei jedem Pixel neu rendern (siehe Minimap-Kommentar zum selben Thema).
   */
  rotationOffsetRef?: MutableRefObject<number>
}

const DIM_ALPHA = 0.1
const EASE = 0.12

const THEME_STYLES = {
  dark: {
    background: '#020617',
    label: '#e2e8f0',
    tier: 'rgba(226,232,240,0.45)',
    ring: '#ffffff',
    linkHover: 'rgba(226,232,240,0.85)',
    link: 'rgba(148,163,184,0.3)',
    linkDim: 'rgba(148,163,184,0.04)',
  },
} as const

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/** `#rrggbb` → `rgba(r,g,b,a)`; Gruppenfarben liegen als Hex vor. */
function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? value.replace(/./g, (c) => c + c) : value
  const int = parseInt(full, 16)
  return `rgba(${(int >> 16) & 255},${(int >> 8) & 255},${int & 255},${alpha})`
}

/** Wie weit ein Knoten vom Median seiner Art abweichen darf. */
const REL_MIN = 0.3
const REL_MAX = 9

/**
 * Radius aus Wissensmenge, Slider und Tiefe.
 *
 * Gemessen **relativ zum Median der eigenen Art** (`sizeRef`), nicht absolut:
 * `val` heißt je Art etwas anderes — Repos liegen im Median bei 1, Aufgaben bei
 * 25 mit Ausreißern bis 598. Absolut gerechnet wurde eine Aufgabe elfmal so
 * groß wie ein Repo, und Aufgaben und Konzepte erschlugen als grüne und orange
 * Klumpen den Rest des Graphen.
 *
 * Die Deckelung hält das Verhältnis zwischen kleinstem und größtem Knoten bei
 * rund 1:2,7 statt 1:11 — genug, um eine Rangfolge zu sehen, zu wenig, um zu
 * dominieren.
 */
export function nodeRadius(node: SceneNode, nodeSize: number): number {
  const ref = node.sizeRef && node.sizeRef > 0 ? node.sizeRef : node.val || 1
  const rel = Math.min(REL_MAX, Math.max(REL_MIN, node.val / ref))
  const base = 2 + Math.sqrt(rel) * 2.2
  const hub = node.members ? 3.5 : 0
  const core = node.kind === 'system' ? 4 : 0
  return (base + hub + core) * nodeSize * (0.55 + 0.45 * (node.depth ?? 1))
}

export default function GraphCanvas({
  scene,
  width,
  height,
  insetRight = 0,
  settings,
  theme,
  activeIds,
  selectedId,
  focus,
  onNodeClick,
  onBackgroundClick,
  onHover,
  onInstance,
  paused = false,
  rotationOffsetRef,
}: Props) {
  const fgRef = useRef<any>(null)
  const hoverRef = useRef<string | null>(null)
  const targetsRef = useRef<Map<string, Target>>(new Map())
  const rotationRef = useRef(0)
  const clockRef = useRef(performance.now())
  const styles = THEME_STYLES[theme]

  const groupColor = useMemo(() => {
    const map = new Map(scene.groups.map((g) => [g.id, g.color]))
    return (node: SceneNode) =>
      map.get(node.group) ?? SCENE_COLORS[theme][node.kind] ?? FALLBACK_COLOR[theme]
  }, [scene.groups, theme])

  const layoutOpts = useMemo(
    () => ({
      groups: scene.groups,
      clusterGap: settings.clusterGap,
      spread: settings.spread,
    }),
    [scene.groups, settings.clusterGap, settings.spread],
  )

  // Breiten- und Längengrade der Kugel hängen nicht an der Drehung. Sie in jedem
  // Bild neu zu bestimmen hieß: die Knotenliste kopieren, mit vierteiligem
  // Vergleich sortieren, zwei Maps anlegen und für jeden Knoten asin/sin/cos
  // rechnen — bei 2000 Knoten und 60 Bildern je Sekunde, auf der Einstiegsansicht.
  // Zuletzt angewandte Drehung — daran hängt, ob ein Bild überhaupt Arbeit macht.
  const appliedRotationRef = useRef(Number.NaN)

  const globe = useMemo(
    () => (settings.layout === 'globe' ? globeBasis(scene.nodes, layoutOpts) : null),
    [settings.layout, scene.nodes, layoutOpts],
  )

  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const n of scene.nodes) map.set(n.id, new Set())
    for (const l of scene.links) {
      const s = endpoint(l.source)
      const t = endpoint(l.target)
      map.get(s)?.add(t)
      map.get(t)?.add(s)
    }
    return map
  }, [scene])

  // Feste Ziele einmal je Layout/Slider berechnen; der Globus dreht sich pro Frame.
  useEffect(() => {
    appliedRotationRef.current = Number.NaN
    targetsRef.current =
      settings.layout === 'globe'
        ? new Map()
        : layoutTargets(settings.layout, scene.nodes, layoutOpts)
  }, [settings.layout, scene, layoutOpts])

  // Wolke: Kräfte inklusive Cluster-Anziehung; strukturierte Layouts pinnen selbst.
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    if (settings.layout !== 'cloud') {
      fg.d3Force('cluster', null)
      return
    }
    for (const n of scene.nodes) {
      n.fx = undefined
      n.fy = undefined
    }
    const centers = clusterCenters(scene.groups, settings.clusterGap)
    const nodes = scene.nodes
    const strength = 0.06
    fg.d3Force('cluster', (alpha: number) => {
      for (const n of nodes) {
        const c = centers.get(n.group)
        if (!c) continue
        const pull = n.kind === 'system' ? strength * 4 : strength / settings.spread
        n.vx = (n.vx ?? 0) + (c.x - (n.x ?? 0)) * pull * alpha
        n.vy = (n.vy ?? 0) + (c.y - (n.y ?? 0)) * pull * alpha
      }
    })
    fg.d3Force('charge')?.strength(-18 - settings.clusterGap * 1.5)
    fg.d3Force('link')?.distance(14 + settings.spread * 12)
    fg.d3ReheatSimulation()
  }, [settings.layout, settings.clusterGap, settings.spread, scene])

  // Kamera nach Layout-Wechsel neu einpassen (nach dem Einschwingen).
  //
  // Eigene Rechnung statt `zoomToFit`: dessen Polsterung gilt ringsum und
  // bezieht sich auf die volle Breite. Das Bedienmenü liegt aber darauf, und in
  // der Ebenenansicht lag die rechte Spalte komplett dahinter.
  useEffect(() => {
    const timer = setTimeout(() => {
      const fg = fgRef.current
      if (!fg) return
      const bounds = boundsOf(scene.nodes)
      if (!bounds) return
      const { k, x, y } = fitTransform(bounds, { width, height, insetRight })
      fg.centerAt(x, y, 700)
      fg.zoom(k, 700)
    }, 400)
    return () => clearTimeout(timer)
  }, [settings.layout, settings.detail, settings.groupMode, width, height, insetRight, scene])

  useEffect(() => {
    if (!focus) return
    const node = scene.nodes.find((n) => n.id === focus.id)
    if (!node || node.x === undefined || node.y === undefined) return
    fgRef.current?.centerAt(node.x, node.y, 600)
    fgRef.current?.zoom(3, 600)
  }, [focus, scene])

  useEffect(() => {
    onInstance?.(fgRef.current)
    return () => onInstance?.(null)
  }, [onInstance])

  const isBright = useCallback(
    (id: string) => {
      const inFilter = activeIds === null || activeIds.has(id)
      const h = hoverRef.current
      const inHover = h === null || id === h || !!neighbours.get(h)?.has(id)
      return inFilter && inHover
    },
    [activeIds, neighbours],
  )

  // ----------------------------------------------------------- Positionsschleife

  const stepPositions = useCallback(() => {
    const now = performance.now()
    const dt = Math.min(64, now - clockRef.current)
    clockRef.current = now
    const animate = settings.motion && !prefersReducedMotion() && !paused

    if (settings.layout === 'cloud') {
      if (!animate) return
      // Sanfter Impuls hält die Wolke lebendig, ohne das Layout zu zerreißen.
      for (const n of scene.nodes) {
        if (n.fx !== undefined) continue
        const p = n.phase ?? 0
        n.vx = (n.vx ?? 0) + Math.sin(now * 0.0006 + p) * 0.006 * dt
        n.vy = (n.vy ?? 0) + Math.cos(now * 0.0005 + p) * 0.006 * dt
      }
      return
    }

    if (settings.layout === 'globe' && globe) {
      if (animate) rotationRef.current += dt * 0.00012
      // Manuelles Drehen (Minimap-Ziehen) wirkt immer, auch bei angehaltener
      // Automatik — sonst ließe sich ein pausierter Globus nicht erkunden.
      const manual = rotationOffsetRef?.current ?? 0
      const rotation = rotationRef.current + manual
      // Steht der Globus still, gibt es nichts neu zu setzen. Vorher lief die
      // volle Berechnung auch dann in jedem Bild weiter.
      if (rotation !== appliedRotationRef.current) {
        appliedRotationRef.current = rotation
        // Schreibt in die vorhandene Map: eine Allokation je Bild weniger.
        globeFrame(globe, rotation, targetsRef.current)
      }
    }

    for (const n of scene.nodes) {
      const target = targetsRef.current.get(n.id)
      if (!target) continue
      const p = n.phase ?? 0
      const driftX = animate ? Math.sin(now * 0.0008 + p) * 2 : 0
      const driftY = animate ? Math.cos(now * 0.0007 + p * 1.3) * 2 : 0
      const tx = target.x + driftX
      const ty = target.y + driftY
      const x = n.x ?? tx
      const y = n.y ?? ty
      n.x = x + (tx - x) * EASE
      n.y = y + (ty - y) * EASE
      n.fx = n.x
      n.fy = n.y
      n.depth = target.depth
    }
  }, [scene, settings.layout, settings.motion, paused, globe, rotationOffsetRef])

  // ----------------------------------------------------------- Zeichnen

  /** Hilfsgeometrie hinter den Knoten: Orbits im Ring, Schichtlinien in den Ebenen. */
  const paintUnderlay = useCallback(
    (ctx: CanvasRenderingContext2D, scale: number) => {
      ctx.save()
      ctx.strokeStyle = styles.tier
      ctx.globalAlpha = 0.25
      ctx.lineWidth = 0.7 / scale
      if (settings.layout === 'ring') {
        const geo = ringGeometry(layoutOpts)
        for (const radius of [geo.outer, ...geo.orbits]) {
          ctx.beginPath()
          ctx.arc(0, 0, radius, 0, 2 * Math.PI)
          ctx.stroke()
        }
        ctx.setLineDash([3 / scale, 4 / scale])
        ctx.beginPath()
        ctx.arc(0, 0, geo.inner, 0, 2 * Math.PI)
        ctx.stroke()
      }
      ctx.restore()
    },
    [settings.layout, layoutOpts, styles],
  )

  const paintNode = useCallback(
    (node: SceneNode, ctx: CanvasRenderingContext2D, scale: number) => {
      const bright = isBright(node.id)
      const r = nodeRadius(node, settings.nodeSize)
      const color = groupColor(node)
      const glow = settings.glow && theme === 'dark'
      const depth = node.depth ?? 1
      const x = node.x ?? 0
      const y = node.y ?? 0
      ctx.globalAlpha = bright ? 0.45 + 0.55 * depth : DIM_ALPHA

      // Leuchten: additiver Halo auf dunklem Grund. Große Knoten und Hubs bekommen
      // einen weichen Verlauf, das Punktraster nur einen billigen Schein — ein
      // Gradient je Knoten und Frame wäre bei mehreren hundert Knoten zu teuer.
      if (glow && bright) {
        const structuralGlow = node.kind === 'system' || !!node.members
        ctx.globalCompositeOperation = 'lighter'
        if (r > 5 || structuralGlow || node.id === hoverRef.current) {
          const halo = r * (structuralGlow ? 5 : 3.6)
          const gradient = ctx.createRadialGradient(x, y, 0, x, y, halo)
          gradient.addColorStop(0, withAlpha(color, 0.5))
          gradient.addColorStop(0.4, withAlpha(color, 0.14))
          gradient.addColorStop(1, withAlpha(color, 0))
          ctx.globalAlpha = 1
          ctx.fillStyle = gradient
          ctx.beginPath()
          ctx.arc(x, y, halo, 0, 2 * Math.PI)
          ctx.fill()
        } else {
          ctx.globalAlpha = 0.16
          ctx.fillStyle = color
          ctx.beginPath()
          ctx.arc(x, y, r * 2.2, 0, 2 * Math.PI)
          ctx.fill()
        }
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = 0.45 + 0.55 * depth
      } else if (bright && (node.kind === 'system' || node.members)) {
        // Helles Theme: flacher Schein statt Bloom.
        ctx.globalAlpha = 0.28
        ctx.beginPath()
        ctx.arc(x, y, r + 6, 0, 2 * Math.PI)
        ctx.fillStyle = color
        ctx.fill()
        ctx.globalAlpha = 0.45 + 0.55 * depth
      }

      ctx.beginPath()
      ctx.arc(x, y, r, 0, 2 * Math.PI)
      ctx.fillStyle = color
      ctx.fill()

      // Vielzitierte Primärquelle: goldener Ring (ADR-0013), unabhängig von der Größe.
      if (bright && node.landmark) {
        ctx.beginPath()
        ctx.arc(x, y, r + 2.2, 0, 2 * Math.PI)
        ctx.lineWidth = 1.6 / scale
        ctx.strokeStyle = LANDMARK_COLOR[theme]
        ctx.stroke()
      }
      if (node.id === selectedId) {
        ctx.beginPath()
        ctx.arc(x, y, r + 3, 0, 2 * Math.PI)
        ctx.lineWidth = 2 / scale
        ctx.strokeStyle = styles.ring
        ctx.stroke()
      }

      const structural = node.kind === 'system' || !!node.members || node.kind === 'service'
      const showLabel =
        bright &&
        (structural ||
          node.id === selectedId ||
          node.id === hoverRef.current ||
          (settings.labels && scale > 0.9))
      if (showLabel) {
        const fontSize = Math.max(3, 11 / scale)
        ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`
        ctx.fillStyle = styles.label
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.globalAlpha = 1
        const label = node.members ? `${node.name} (${node.members.length})` : node.name
        ctx.fillText(label.length > 46 ? `${label.slice(0, 45)}…` : label, x, y + r + 2)
      }
      ctx.globalAlpha = 1
    },
    [
      isBright,
      groupColor,
      settings.nodeSize,
      settings.labels,
      settings.glow,
      selectedId,
      styles,
      theme,
    ],
  )

  const paintPointerArea = useCallback(
    (node: SceneNode, color: string, ctx: CanvasRenderingContext2D) => {
      ctx.beginPath()
      ctx.arc(node.x ?? 0, node.y ?? 0, nodeRadius(node, settings.nodeSize) + 2, 0, 2 * Math.PI)
      ctx.fillStyle = color
      ctx.fill()
    },
    [settings.nodeSize],
  )

  const paintOverlay = useCallback(
    (ctx: CanvasRenderingContext2D, scale: number) => {
      if (!settings.hubLabels) return
      ctx.save()
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const fontSize = Math.max(6, 12 / scale)
      ctx.font = `600 ${fontSize}px ui-sans-serif, system-ui, sans-serif`

      // Ring/Ebenen tragen zusätzlich die Namen der Systemschichten.
      if (settings.layout === 'ring' || settings.layout === 'layers') {
        ctx.textAlign = settings.layout === 'layers' ? 'left' : 'center'
        for (const pos of tierLabelPositions(settings.layout, layoutOpts)) {
          // In den Ebenen färbt die Reihe ihren Namen — wie ihre Knoten.
          ctx.fillStyle =
            settings.layout === 'layers'
              ? (scene.groups.find((g) => g.tier === pos.tier)?.color ?? styles.tier)
              : styles.tier
          ctx.globalAlpha = settings.layout === 'layers' ? 0.8 : 1
          ctx.fillText(TIER_LABELS[pos.tier].toUpperCase(), pos.x, pos.y)
        }
        ctx.globalAlpha = 1
        ctx.textAlign = 'center'
      }

      // Cluster-Namen: in den Ebenen unter der Spalte, sonst über der Wolke.
      const sums = new Map<string, { x: number; y: number; n: number; top: number; bottom: number }>()
      for (const node of scene.nodes) {
        if (node.synthetic) continue
        const acc = sums.get(node.group) ?? { x: 0, y: 0, n: 0, top: Infinity, bottom: -Infinity }
        acc.x += node.x ?? 0
        acc.y += node.y ?? 0
        acc.n += 1
        acc.top = Math.min(acc.top, node.y ?? 0)
        acc.bottom = Math.max(acc.bottom, node.y ?? 0)
        sums.set(node.group, acc)
      }
      const layers = settings.layout === 'layers'
      for (const group of scene.groups) {
        const acc = sums.get(group.id)
        if (!acc || acc.n === 0) continue
        ctx.fillStyle = group.color
        ctx.globalAlpha = layers ? 0.65 : 0.75
        const label = group.label.toUpperCase()
        ctx.fillText(
          layers && label.length > 14 ? `${label.slice(0, 13)}…` : label,
          acc.x / acc.n,
          layers ? acc.bottom + 16 / scale : acc.top - 12 / scale,
        )
      }
      ctx.restore()
    },
    [scene, settings.hubLabels, settings.layout, layoutOpts, styles],
  )

  const linkVisibility = useCallback(
    (link: SceneLink) => {
      const s = endpoint(link.source)
      const t = endpoint(link.target)
      if (activeIds !== null && !(activeIds.has(s) || activeIds.has(t))) return false
      if (!settings.linksOnHover) return true
      const anchor = hoverRef.current ?? selectedId
      if (!anchor) return false
      return s === anchor || t === anchor
    },
    [activeIds, settings.linksOnHover, selectedId],
  )

  const linkColor = useCallback(
    (link: SceneLink) => {
      const s = endpoint(link.source)
      const t = endpoint(link.target)
      const anchor = hoverRef.current ?? selectedId
      if (anchor && (s === anchor || t === anchor)) return styles.linkHover
      const inFilter = activeIds === null || (activeIds.has(s) && activeIds.has(t))
      return inFilter ? styles.link : styles.linkDim
    },
    [activeIds, selectedId, styles],
  )

  return (
    // Ein <canvas> ist fuer Screenreader eine leere Flaeche. Die Karte ist die
    // Einstiegsansicht des Graphen — ohne Beschreibung stuende dort nichts.
    // Der Inhalt selbst bleibt visuell; wer ihn lesen will, nutzt die Liste
    // daneben und die Suche im Menue.
    <div
      role="img"
      aria-label={`Wissenskarte: ${scene.nodes.length} Knoten, ${scene.links.length} Verbindungen. Auswahl und Suche über das Menü.`}
    >
    <ForceGraph2D
      ref={fgRef}
      graphData={scene}
      width={width}
      height={height}
      backgroundColor={styles.background}
      // Wir zeichnen jeden Frame selbst (Drift, Rotation, Layout-Übergänge).
      autoPauseRedraw={false}
      cooldownTicks={settings.layout === 'cloud' ? Infinity : 0}
      enableNodeDrag={settings.layout === 'cloud'}
      nodeVal={(n: SceneNode) => n.val}
      nodeLabel={(n: SceneNode) =>
        n.members
          ? `${n.name} — ${n.members.length} Knoten (Klick: aufklappen)`
          : `${n.kind}: ${n.name}` +
            (typeof n.citations === 'number'
              ? ` · ${n.citations.toLocaleString('de-DE')} Zitationen`
              : '')
      }
      nodeCanvasObject={paintNode}
      nodePointerAreaPaint={paintPointerArea}
      linkVisibility={linkVisibility}
      linkColor={linkColor}
      linkWidth={(l: SceneLink) => 0.5 + Math.min(3, l.weight) * 1.2}
      onRenderFramePre={(ctx: CanvasRenderingContext2D, scale: number) => {
        stepPositions()
        paintUnderlay(ctx, scale)
      }}
      onRenderFramePost={paintOverlay}
      // Hover nur im Ref: der Canvas zeichnet ohnehin jeden Frame, ein React-Render
      // pro Mausbewegung wäre reine Last.
      onNodeHover={(n: SceneNode | null) => {
        hoverRef.current = n ? n.id : null
        onHover?.(n)
      }}
      onNodeClick={(n: SceneNode) => onNodeClick(n)}
      onBackgroundClick={onBackgroundClick}
      d3AlphaDecay={settings.layout === 'cloud' ? 0.012 : 0.0228}
      warmupTicks={settings.layout === 'cloud' ? 40 : 0}
      minZoom={0.05}
      maxZoom={12}
    />
    </div>
  )
}
