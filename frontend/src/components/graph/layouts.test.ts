import { describe, expect, it } from 'vitest'
import { clusterCenters, layoutTargets, ringGeometry, tierLabelPositions } from './layouts'
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

  it('stapelt die Schichten von unten (Fundament) nach oben (Dienste)', () => {
    const y = (id: string) => targets.get(id)!.y
    expect(y('kern')).toBeGreaterThan(y('c1'))
    expect(y('c1')).toBeGreaterThan(y('p1'))
    expect(y('p1')).toBeGreaterThan(y('prj'))
    expect(y('prj')).toBeGreaterThan(y('svc1'))
  })

  it('beschriftet jede Ebene', () => {
    expect(tierLabelPositions('layers', OPTS)).toHaveLength(5)
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
