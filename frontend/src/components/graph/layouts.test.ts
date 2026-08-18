import { describe, expect, it } from 'vitest'
import {
  clusterCenters,
  columnWidth,
  globeSectors,
  layerGeometry,
  layoutTargets,
  ringGeometry,
  tierLabelPositions,
} from './layouts'
import { KIND_TIER, type SceneGroup, type SceneKind, type SceneNode } from './scene'

function node(id: string, kind: SceneKind, group: string, val = 1): SceneNode {
  return {
    id,
    kind,
    name: id,
    status: 'verified',
    first_seen: '2026-01-01T00:00:00Z',
    val,
    meta: {},
    group,
    tier: KIND_TIER[kind],
    phase: id.length,
  }
}

const NODES: SceneNode[] = [
  node('kern', 'system', 'system', 12),
  node('c1', 'concept', 'concept', 5),
  node('c2', 'concept', 'concept', 3),
  node('p1', 'paper', 'paper', 4),
  node('p2', 'paper', 'paper', 2),
  node('prj', 'project', 'project'),
  node('svc1', 'service', 'service'),
  node('svc2', 'service', 'service'),
]

const GROUPS: SceneGroup[] = [
  { id: 'system', label: 'Kern', color: '#f00', tier: 0, count: 1 },
  { id: 'concept', label: 'Konzepte', color: '#0f0', tier: 1, count: 2 },
  { id: 'paper', label: 'Papers', color: '#00f', tier: 2, count: 2 },
  { id: 'project', label: 'Projekte', color: '#0ff', tier: 3, count: 1 },
  { id: 'service', label: 'Dienste', color: '#888', tier: 4, count: 2 },
]

const OPTS = { groups: GROUPS, clusterGap: 10, spread: 1.45 }

const radius = (t: { x: number; y: number }) => Math.hypot(t.x, t.y)

describe('layoutTargets: ring', () => {
  const targets = layoutTargets('ring', NODES, OPTS)
  const geo = ringGeometry(OPTS)

  it('setzt den Kern in die Mitte', () => {
    expect(targets.get('kern')).toEqual({ x: 0, y: 0, depth: 1 })
  })

  it('füllt Wissen und Quellen zwischen Innen- und Außenkante', () => {
    for (const id of ['c1', 'c2', 'p1', 'p2']) {
      const r = radius(targets.get(id)!)
      expect(r).toBeGreaterThan(geo.inner * 0.85)
      expect(r).toBeLessThan(geo.outer * 1.15)
    }
  })

  it('legt Projekte und Dienste auf die äußeren Orbits', () => {
    // Leichte Streuung ist gewollt (lebendiger Ring) — Toleranz 5 %.
    const onOrbit = (id: string, orbit: number) =>
      expect(Math.abs(radius(targets.get(id)!) - orbit) / orbit).toBeLessThan(0.05)
    onOrbit('prj', geo.orbits[0])
    onOrbit('svc1', geo.orbits[1])
    onOrbit('svc2', geo.orbits[1])
  })

  it('hält Cluster in getrennten Sektoren', () => {
    // Winkel ab dem Sektorstart (12 Uhr) im Uhrzeigersinn abgewickelt.
    const angle = (id: string) => {
      const t = targets.get(id)!
      return (Math.atan2(t.y, t.x) + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI)
    }
    // Zwei Konzepte, zwei Papers ⇒ je ein Halbkreis, keine Überschneidung.
    for (const id of ['c1', 'c2']) expect(angle(id)).toBeLessThan(Math.PI)
    for (const id of ['p1', 'p2']) expect(angle(id)).toBeGreaterThanOrEqual(Math.PI)
  })

  it('skaliert mit dem Cluster-Abstand', () => {
    const wide = layoutTargets('ring', NODES, { ...OPTS, clusterGap: 20 })
    expect(radius(wide.get('p1')!)).toBeGreaterThan(radius(targets.get('p1')!))
  })
})

describe('layoutTargets: layers', () => {
  const targets = layoutTargets('layers', NODES, OPTS)
  const geo = layerGeometry(OPTS)
  const y = (id: string) => targets.get(id)!.y

  it('stellt die Wissensspalten auf die Fußlinie und lässt sie nach oben wachsen', () => {
    // Konzepte: zwei Knoten, Spaltenbreite ≥ 3 ⇒ beide in der untersten Reihe.
    expect(y('c1')).toBeCloseTo(geo.baseline, 5)
    expect(y('c2')).toBeCloseTo(geo.baseline, 5)
    const many = Array.from({ length: 12 }, (_, i) => node(`c${i + 10}`, 'concept', 'concept'))
    const tall = layoutTargets('layers', [...NODES, ...many], OPTS)
    const top = Math.min(...many.map((n) => tall.get(n.id)!.y))
    expect(top).toBeLessThan(geo.baseline) // wächst nach oben
  })

  it('legt die Systemreihen unter die Fußlinie: Dienste, Projekte, Kern', () => {
    expect(y('svc1')).toBeGreaterThan(geo.baseline)
    expect(y('prj')).toBeGreaterThan(y('svc1'))
    expect(y('kern')).toBeGreaterThan(y('prj'))
    // Eine Reihe liegt auf einer Höhe.
    expect(y('svc2')).toBeCloseTo(y('svc1'), 5)
  })

  it('trennt die Spalten horizontal', () => {
    const x = (id: string) => targets.get(id)!.x
    expect(Math.abs(x('c1') - x('p1'))).toBeGreaterThan(geo.cell)
  })

  it('beschriftet die drei Systemreihen', () => {
    const labels = tierLabelPositions('layers', OPTS)
    expect(labels.map((l) => l.tier)).toEqual([4, 3, 0])
  })
})

describe('layoutTargets: globe', () => {
  it('liefert Tiefe zwischen 0 und 1', () => {
    const targets = layoutTargets('globe', NODES, OPTS)
    for (const t of targets.values()) {
      expect(t.depth).toBeGreaterThanOrEqual(0)
      expect(t.depth).toBeLessThanOrEqual(1)
    }
  })

  it('dreht sich reproduzierbar', () => {
    const a = layoutTargets('globe', NODES, { ...OPTS, rotation: 0 })
    const b = layoutTargets('globe', NODES, { ...OPTS, rotation: 0 })
    const turned = layoutTargets('globe', NODES, { ...OPTS, rotation: Math.PI / 2 })
    expect(a.get('c1')).toEqual(b.get('c1'))
    expect(turned.get('c1')).not.toEqual(a.get('c1'))
  })
})

describe('cloud', () => {
  it('überlässt die Positionen der Simulation', () => {
    expect(layoutTargets('cloud', NODES, OPTS).size).toBe(0)
  })

  it('verteilt die Cluster-Zentren, Kern in der Mitte', () => {
    const centers = clusterCenters(GROUPS, 10)
    expect(centers.get('system')).toEqual({ x: 0, y: 0 })
    const others = GROUPS.filter((g) => g.tier > 0).map((g) => centers.get(g.id)!)
    for (const c of others) expect(Math.hypot(c.x, c.y)).toBeGreaterThan(0)
    // Keine zwei Cluster teilen sich einen Ort.
    const unique = new Set(others.map((c) => `${c.x.toFixed(3)}|${c.y.toFixed(3)}`))
    expect(unique.size).toBe(others.length)
  })
})

/**
 * Der Globus verteilte die Kugel früher gleichmäßig auf die Gruppen, unabhängig
 * von ihrer Größe. Bei 1.018 Knoten in der einen und 32 in der anderen Gruppe war
 * die eine 28-mal dichter belegt als die andere — sichtbar als verklumpte Sichel.
 */
describe('globeSectors', () => {
  it('gibt großen Gruppen entsprechend mehr Bogen', () => {
    const [big, small] = globeSectors([100, 10])
    expect(big / small).toBeGreaterThan(5)
  })

  it('hält die Belegungsdichte über die Gruppen hinweg annähernd gleich', () => {
    const sizes = [1018, 260, 194, 129, 101, 69, 59, 51, 47, 40, 32]
    const widths = globeSectors(sizes)
    const density = sizes.map((n, i) => n / widths[i])
    expect(Math.max(...density) / Math.min(...density)).toBeLessThan(1.5)
  })

  it('summiert sich auf den vollen Kreis', () => {
    const sum = globeSectors([5, 3, 2, 1]).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(2 * Math.PI, 6)
  })

  it('lässt eine winzige Gruppe nicht auf null zusammenfallen', () => {
    const [, tiny] = globeSectors([5000, 1])
    // Ohne Boden wären das 0,07° — zwischen den Nachbarn unsichtbar.
    expect((tiny * 180) / Math.PI).toBeGreaterThan(1)
  })

  it('kommt mit einer einzigen Gruppe klar', () => {
    expect(globeSectors([7])).toHaveLength(1)
    expect(globeSectors([7])[0]).toBeCloseTo(2 * Math.PI, 6)
  })
})

/**
 * Die Spaltenbreite war bei 9 gedeckelt: 1.018 Knoten wurden 9 breit und 114 hoch.
 * Der Turm sprengte die Ansicht und schrumpfte alles andere auf Streichholzgröße.
 */
describe('columnWidth', () => {
  it('hält das Seitenverhältnis auch bei großen Gruppen im Rahmen', () => {
    for (const count of [40, 100, 250, 500, 1018]) {
      const width = columnWidth(count)
      const height = Math.ceil(count / width)
      expect(height / width).toBeLessThan(2.5)
    }
  })

  it('lässt kleine Gruppen nicht zu Fäden werden', () => {
    expect(columnWidth(1)).toBeGreaterThanOrEqual(3)
    expect(columnWidth(4)).toBeGreaterThanOrEqual(3)
  })

  it('wächst monoton mit der Knotenzahl', () => {
    const widths = [10, 50, 200, 800].map(columnWidth)
    expect(widths).toEqual([...widths].sort((a, b) => a - b))
  })
})
