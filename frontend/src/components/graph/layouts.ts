/**
 * Layout-Engine des Graph-Explorers — reine Geometrie, kein Canvas.
 *
 * `cloud` bleibt kräftesimuliert (nur die Cluster-Zentren kommen von hier),
 * `globe`, `ring` und `layers` liefern feste Zielpositionen, auf die der Canvas
 * die Knoten weich zieht. Alles deterministisch: gleiche Eingabe, gleiches Bild.
 */
import { TIER_COUNT, type SceneGroup, type SceneNode } from './scene'

export type LayoutId = 'cloud' | 'globe' | 'ring' | 'layers'

export const LAYOUTS: { id: LayoutId; label: string }[] = [
  { id: 'cloud', label: 'Cloud' },
  { id: 'globe', label: 'Globus' },
  { id: 'ring', label: 'Ring' },
  { id: 'layers', label: 'Ebenen' },
]

/** Virtuelle Grundgröße; die Kamera skaliert am Ende per `zoomToFit`. */
export const BASE = 320

export interface LayoutOptions {
  groups: SceneGroup[]
  /** Slider „Cluster-Abstand" (0..20). */
  clusterGap: number
  /** Slider „Streuung" (0.5..3). */
  spread: number
  /** Globus-Rotation in Radiant. */
  rotation?: number
}

export interface Target {
  x: number
  y: number
  /** 0 = hinten, 1 = vorn — steuert Größe und Deckkraft. */
  depth: number
}

/** Stabile Reihenfolge: erst Schicht, dann Gruppe, dann Vernetzungsgrad. */
function ordered(nodes: SceneNode[]): SceneNode[] {
  return [...nodes].sort(
    (a, b) =>
      a.tier - b.tier ||
      a.group.localeCompare(b.group) ||
      b.val - a.val ||
      a.id.localeCompare(b.id),
  )
}

function byGroup(nodes: SceneNode[]): Map<string, SceneNode[]> {
  const map = new Map<string, SceneNode[]>()
  for (const n of ordered(nodes)) {
    const list = map.get(n.group)
    if (list) list.push(n)
    else map.set(n.group, [n])
  }
  return map
}

/** Reproduzierbares Rauschen aus der Knoten-Id (kein Math.random im Layout). */
function jitter(node: SceneNode, salt: number): number {
  const phase = node.phase ?? 0
  return Math.sin(phase * (salt + 1.7) + salt) // -1..1
}

/**
 * Cluster-Zentren auf einem Kreis — Grundlage der Wolken-Ansicht: jedes Thema
 * bekommt einen eigenen Ort, damit sich Wissensbereiche räumlich nicht mischen.
 */
export function clusterCenters(
  groups: SceneGroup[],
  clusterGap: number,
): Map<string, { x: number; y: number }> {
  const centers = new Map<string, { x: number; y: number }>()
  const radius = BASE * (0.35 + clusterGap / 20)
  const count = Math.max(1, groups.length)
  groups.forEach((g, i) => {
    if (g.tier === 0) {
      centers.set(g.id, { x: 0, y: 0 })
      return
    }
    const angle = (2 * Math.PI * i) / count - Math.PI / 2
    centers.set(g.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius })
  })
  return centers
}

/** Kugel: Gruppen belegen Längengrad-Sektoren, Rotation dreht um die Y-Achse. */
function globeTargets(nodes: SceneNode[], opts: LayoutOptions): Map<string, Target> {
  const out = new Map<string, Target>()
  const groups = byGroup(nodes)
  const rotation = opts.rotation ?? 0
  const radius = BASE * (0.55 + opts.clusterGap / 40)
  const sectors = Math.max(1, groups.size)
  let index = 0
  for (const [, list] of groups) {
    const lonStart = (2 * Math.PI * index) / sectors
    const lonWidth = (2 * Math.PI) / sectors
    list.forEach((node, i) => {
      const t = (i + 0.5) / list.length
      // Golden-Ratio-Folge streut die Breitengrade, ohne sie zu bündeln.
      const v = (i * 0.6180339887) % 1
      const lat = Math.asin(2 * v - 1)
      const lon = lonStart + lonWidth * t + rotation
      const r = radius * (1 + jitter(node, i) * 0.03 * opts.spread)
      const cosLat = Math.cos(lat)
      out.set(node.id, {
        x: r * cosLat * Math.sin(lon),
        y: -r * Math.sin(lat),
        depth: (cosLat * Math.cos(lon) + 1) / 2,
      })
    })
    index += 1
  }
  return out
}

/** Maße der Ringansicht — teilt sich der Canvas für die Hilfskreise. */
export function ringGeometry(opts: LayoutOptions) {
  const scale = 0.55 + opts.clusterGap / 22
  return {
    /** Freiraum um den Kern. */
    inner: BASE * 0.24 * scale,
    /** Außenkante der Wissens-Scheibe. */
    outer: BASE * 0.86 * scale,
    /** Orbit der Projekte bzw. der Dienste. */
    orbits: [BASE * 1 * scale, BASE * 1.14 * scale],
    core: BASE * 0.1 * scale,
  }
}

/**
 * Ring: Kern in der Mitte, darum die Wissens-Scheibe in Cluster-Sektoren
 * (flächengleich gefüllt, damit große Themen breite Tortenstücke belegen),
 * außen Projekte und Dienste als Satelliten auf dünnen Orbits.
 */
function ringTargets(nodes: SceneNode[], opts: LayoutOptions): Map<string, Target> {
  const out = new Map<string, Target>()
  const geo = ringGeometry(opts)

  for (const n of nodes.filter((x) => x.tier === 0)) out.set(n.id, { x: 0, y: 0, depth: 1 })

  const disc = ordered(nodes.filter((n) => n.tier === 1 || n.tier === 2))
  const total = disc.length || 1
  const sectorGap = 0.08
  let angle = -Math.PI / 2
  for (const [, list] of byGroup(disc)) {
    const sector = (2 * Math.PI * list.length) / total
    const start = angle + (sector * sectorGap) / 2
    const width = sector * (1 - sectorGap)
    list.forEach((node, i) => {
      // sqrt(t): gleichmäßige Flächendichte statt Gedränge am Innenrand.
      const t = (i + 0.5) / list.length
      const radius = geo.inner + (geo.outer - geo.inner) * Math.sqrt(t)
      const a = start + width * ((i * 0.6180339887) % 1)
      const r = radius + jitter(node, i) * 3 * opts.spread
      out.set(node.id, { x: Math.cos(a) * r, y: Math.sin(a) * r, depth: 1 })
    })
    angle += sector
  }

  for (let tier = 3; tier < TIER_COUNT; tier += 1) {
    const list = ordered(nodes.filter((n) => n.tier === tier))
    if (list.length === 0) continue
    const radius = geo.orbits[Math.min(geo.orbits.length - 1, tier - 3)]
    list.forEach((node, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * (i + 0.5)) / list.length
      const r = radius * (1 + jitter(node, i) * 0.02 * opts.spread)
      out.set(node.id, { x: Math.cos(a) * r, y: Math.sin(a) * r, depth: 1 })
    })
  }
  return out
}

/** Ebenen: die Systemschichten vertikal gestapelt, Fundament unten. */
function layerTargets(nodes: SceneNode[], opts: LayoutOptions): Map<string, Target> {
  const out = new Map<string, Target>()
  const height = BASE * 1.4 * (0.6 + opts.clusterGap / 25)
  const step = height / (TIER_COUNT - 1)
  const width = BASE * 2.1
  for (let tier = 0; tier < TIER_COUNT; tier += 1) {
    const inTier = ordered(nodes.filter((n) => n.tier === tier))
    if (inTier.length === 0) continue
    const y = height / 2 - tier * step
    const groups = byGroup(inTier)
    const total = inTier.length
    // Flache Schichten bleiben einreihig; große Schichten wachsen in die Tiefe.
    const rows = Math.max(1, Math.min(9, Math.ceil(total / 26)))
    let cursor = -width / 2
    for (const [, list] of groups) {
      const bandWidth = (width * list.length) / total
      const cols = Math.max(1, Math.ceil(list.length / rows))
      list.forEach((node, i) => {
        const row = i % rows
        const col = Math.floor(i / rows)
        const depth = rows === 1 ? 1 : 1 - (0.45 * row) / (rows - 1)
        out.set(node.id, {
          x: cursor + (bandWidth * (col + 0.5)) / cols + jitter(node, i) * 2 * opts.spread,
          y: y - row * 6 * opts.spread,
          depth,
        })
      })
      cursor += bandWidth
    }
  }
  return out
}

/**
 * Zielpositionen für ein Layout. `cloud` liefert bewusst nichts — dort
 * positioniert die Kräftesimulation, gezogen von {@link clusterCenters}.
 */
export function layoutTargets(
  layout: LayoutId,
  nodes: SceneNode[],
  opts: LayoutOptions,
): Map<string, Target> {
  switch (layout) {
    case 'globe':
      return globeTargets(nodes, opts)
    case 'ring':
      return ringTargets(nodes, opts)
    case 'layers':
      return layerTargets(nodes, opts)
    default:
      return new Map()
  }
}

/** Beschriftung der Ringe bzw. Ebenen (Position im Graph-Koordinatensystem). */
export function tierLabelPositions(
  layout: LayoutId,
  opts: LayoutOptions,
): { tier: number; x: number; y: number }[] {
  if (layout === 'ring') {
    // Nur die Orbits werden beschriftet; die Scheibe trägt die Cluster-Namen.
    const geo = ringGeometry(opts)
    return geo.orbits.map((radius, i) => ({ tier: 3 + i, x: 0, y: -radius - 12 }))
  }
  if (layout === 'layers') {
    const height = BASE * 1.4 * (0.6 + opts.clusterGap / 25)
    const step = height / (TIER_COUNT - 1)
    return Array.from({ length: TIER_COUNT }, (_, tier) => ({
      tier,
      x: -BASE * 1.25,
      y: height / 2 - tier * step,
    }))
  }
  return []
}
