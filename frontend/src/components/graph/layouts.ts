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

/**
 * Mindestanteil einer Gruppe am Globus, als Bruchteil des gleichmäßigen Anteils.
 * Rein proportional bekäme eine Ein-Knoten-Gruppe einen Sektor von Bruchteilen
 * eines Grades und verschwände zwischen den Nachbarn.
 */
const GLOBE_MIN_SHARE = 0.25

/**
 * Kugel: Gruppen belegen Längengrad-Sektoren, Rotation dreht um die Y-Achse.
 *
 * Die Sektorbreite folgt der **Knotenzahl**, nicht der Gruppenzahl. Gleich breite
 * Sektoren ließen die dichten Gruppen zu einem Band verklumpen, während kleine
 * Gruppen dieselbe Fläche leer stehen ließen: gemessen 1.018 Knoten auf 9,1 % der
 * Fläche gegen 32 Knoten auf ebenfalls 9,1 % — Faktor 28 im Gedränge. Auf einer
 * Kugel ist die Fläche eines Längengrad-Sektors proportional zu seiner Breite,
 * also macht ein Anteil nach Knotenzahl die Belegung gleichmäßig.
 */
/**
 * Winkelbreite je Gruppe (Radiant), Summe 2π.
 *
 * Anteil nach Knotenzahl mit einem Boden, damit eine Ein-Knoten-Gruppe nicht auf
 * Bruchteile eines Grades zusammenfällt. Als eigene Funktion, weil sich das
 * Verhältnis so prüfen lässt — aus fertigen Kugelkoordinaten zurückgerechnet ist
 * es nahe den Polen numerisch wertlos.
 */
export function globeSectors(sizes: number[]): number[] {
  const total = sizes.reduce((a, b) => a + b, 0) || 1
  const floor = GLOBE_MIN_SHARE / Math.max(1, sizes.length)
  const raw = sizes.map((n) => Math.max(floor, n / total))
  const sum = raw.reduce((a, b) => a + b, 0) || 1
  return raw.map((share) => (2 * Math.PI * share) / sum)
}

/** Ein Knoten auf der Kugel, unabhängig von der Drehung. */
export interface GlobePoint {
  id: string
  /** Breitengrad in Radiant. */
  lat: number
  /** Längengrad ohne Drehung, in Radiant. */
  lon: number
  /** Abstand vom Mittelpunkt inkl. Streuung. */
  r: number
}

/**
 * Die drehungsunabhängige Hälfte des Globus.
 *
 * Sortieren, Gruppieren und die Trigonometrie der Breitengrade hängen allein an
 * den Knoten und den beiden Reglern — nicht an der Drehung. Das einmal je Szene
 * zu rechnen statt in jedem Bild ist der ganze Trick hinter `globeFrame`.
 */
export function globeBasis(nodes: SceneNode[], opts: LayoutOptions): GlobePoint[] {
  const groups = byGroup(nodes)
  const radius = BASE * (0.55 + opts.clusterGap / 40)
  const widths = globeSectors([...groups.values()].map((list) => list.length))
  const points: GlobePoint[] = []

  let lonStart = 0
  let index = 0
  for (const [, list] of groups) {
    const lonWidth = widths[index]
    list.forEach((node, i) => {
      const t = (i + 0.5) / list.length
      // Golden-Ratio-Folge streut die Breitengrade, ohne sie zu bündeln.
      const v = (i * 0.6180339887) % 1
      points.push({
        id: node.id,
        lat: Math.asin(2 * v - 1),
        lon: lonStart + lonWidth * t,
        r: radius * (1 + jitter(node, i) * 0.03 * opts.spread),
      })
    })
    lonStart += lonWidth
    index += 1
  }
  return points
}

/**
 * Die Kugel um `rotation` gedreht.
 *
 * Schreibt in `out`, wenn eine Map übergeben wird: in der Bildschleife spart das
 * eine Map-Allokation je Bild.
 */
export function globeFrame(
  basis: GlobePoint[],
  rotation: number,
  out: Map<string, Target> = new Map(),
): Map<string, Target> {
  for (const p of basis) {
    const lon = p.lon + rotation
    const cosLat = Math.cos(p.lat)
    const existing = out.get(p.id)
    const x = p.r * cosLat * Math.sin(lon)
    const y = -p.r * Math.sin(p.lat)
    const depth = (cosLat * Math.cos(lon) + 1) / 2
    if (existing) {
      existing.x = x
      existing.y = y
      existing.depth = depth
    } else {
      out.set(p.id, { x, y, depth })
    }
  }
  return out
}

function globeTargets(nodes: SceneNode[], opts: LayoutOptions): Map<string, Target> {
  return globeFrame(globeBasis(nodes, opts), opts.rotation ?? 0)
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

/**
 * Spaltenbreite einer Wissensgruppe in Rasterzellen.
 *
 * Früher bei 9 gedeckelt — damit wurde die größte Gruppe 9 breit und 114 hoch, ein
 * Turm, der die Ansicht sprengte und alles andere zu Streichhölzern schrumpfen
 * ließ. Ohne Deckel wächst die Breite mit der Wurzel der Knotenzahl, das Seiten-
 * verhältnis bleibt dadurch näherungsweise gleich: aus 1.018 Knoten werden 43 × 24
 * statt 9 × 114.
 */
export function columnWidth(count: number): number {
  return Math.min(48, Math.max(3, Math.round(Math.sqrt(count * 1.8))))
}

/** Maße der Ebenenansicht — der Canvas beschriftet damit Spalten und Reihen. */
export function layerGeometry(opts: LayoutOptions) {
  const cell = 8.5 * (0.6 + opts.clusterGap / 26)
  return {
    /** Rasterabstand innerhalb einer Spalte. */
    cell,
    /** Fußlinie: Spalten stehen darauf, Systemreihen liegen darunter. */
    baseline: BASE * 0.2,
    columnGap: cell * 2.6,
    rowStep: cell * 3.2,
    /** Abstand der ersten Systemreihe zur Fußlinie. */
    rowOffset: cell * 7,
  }
}

/**
 * Gesamtbreite des Spaltenblocks — aus den Gruppengrößen, ohne die Knoten selbst.
 * Beschriftung und Systemreihen richten sich danach aus; sonst stehen sie an einer
 * geratenen Kante statt an der echten.
 */
export function layerSpan(opts: LayoutOptions): number {
  const geo = layerGeometry(opts)
  const columns = opts.groups.filter((g) => g.tier === 1 || g.tier === 2)
  if (columns.length === 0) return BASE
  return columns.reduce(
    (sum, g) => sum + columnWidth(g.count) * geo.cell + geo.columnGap,
    -geo.columnGap,
  )
}

/** Systemreihen von unten nach oben: Fundament, Projekte, Dienste. */
const LAYER_ROWS = [4, 3, 0] as const

/**
 * Ebenen: Wissensbereiche als Rasterspalten, unten bündig auf einer Fußlinie —
 * die Spaltenhöhe zeigt so direkt, wie viel in einem Bereich steckt. Darunter
 * liegen die Systemschichten als einzelne Reihen (Dienste ▸ Projekte ▸ Kern).
 */
function layerTargets(nodes: SceneNode[], opts: LayoutOptions): Map<string, Target> {
  const out = new Map<string, Target>()
  const geo = layerGeometry(opts)

  const knowledge = ordered(nodes.filter((n) => n.tier === 1 || n.tier === 2))
  const columns = [...byGroup(knowledge).entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  )
  const totalWidth = columns.reduce(
    (sum, [, list]) => sum + columnWidth(list.length) * geo.cell + geo.columnGap,
    -geo.columnGap,
  )

  let cursor = -totalWidth / 2
  for (const [, list] of columns) {
    const cols = Math.min(columnWidth(list.length), list.length)
    const width = cols * geo.cell
    list.forEach((node, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      out.set(node.id, {
        x: cursor + (col + 0.5) * geo.cell,
        // Zeile 0 unten: die Spalte wächst nach oben.
        y: geo.baseline - row * geo.cell,
        depth: 1,
      })
    })
    cursor += width + geo.columnGap
  }

  // Systemreihen über dieselbe Breite spannen wie der Spaltenblock. Auf festem
  // Rasterabstand drängten sich sechs Dienste auf einem Fünftel der Fläche —
  // ihre Namen überlagerten sich zu einer unlesbaren Zeile.
  LAYER_ROWS.forEach((tier, index) => {
    const list = ordered(nodes.filter((n) => n.tier === tier))
    if (list.length === 0) return
    const y = geo.baseline + geo.rowOffset + index * geo.rowStep
    const span = Math.max(totalWidth * 0.8, geo.cell * 2.4 * (list.length - 1))
    const step = list.length > 1 ? span / (list.length - 1) : 0
    list.forEach((node, i) => {
      out.set(node.id, { x: -span / 2 + i * step, y, depth: 1 })
    })
  })

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
    // Nur die Systemreihen tragen links ihren Namen; die Spalten beschriftet
    // der Canvas an ihrer Fußlinie. Der Name steht am echten linken Rand der
    // Reihe, nicht an einer festen Koordinate — sonst überlappt er bei breitem
    // Spaltenblock die Knoten oder schwebt bei schmalem im Nichts.
    const geo = layerGeometry(opts)
    const left = -Math.max(layerSpan(opts) * 0.8, BASE) / 2 - geo.cell * 3
    return LAYER_ROWS.map((tier, index) => ({
      tier,
      x: left,
      y: geo.baseline + geo.rowOffset + index * geo.rowStep,
    }))
  }
  return []
}
