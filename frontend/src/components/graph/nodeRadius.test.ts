/**
 * Knotengröße: relativ zur eigenen Art, nicht absolut.
 *
 * `val` ist über die Arten hinweg nicht vergleichbar — gemessen am echten
 * Korpus liegen Repos im Median bei 1, Aufgaben bei 25 mit Ausreißern bis 598.
 * Absolut gerechnet wurde eine Aufgabe elfmal so groß gezeichnet wie ein Repo,
 * und der Graph bestand optisch aus grünen und orangen Klumpen.
 */
import { describe, expect, it } from 'vitest'
import { nodeRadius } from './GraphCanvas'
import { assignSizeRefs, type SceneKind, type SceneNode } from './scene'

function node(kind: SceneKind, val: number, extra: Partial<SceneNode> = {}): SceneNode {
  return {
    id: `${kind}-${val}`,
    kind,
    name: kind,
    status: 'verified',
    first_seen: '2026-01-01T00:00:00Z',
    val,
    meta: {},
    group: kind,
    tier: 1,
    ...extra,
  }
}

/** Nachgebildete Verteilung des echten Korpus (Mediane 1 bzw. 25). */
function korpus(): SceneNode[] {
  const repos = [1, 1, 1, 2, 6].map((v) => node('repo', v))
  const tasks = [11, 20, 25, 115, 598].map((v) => node('task', v))
  const nodes = [...repos, ...tasks]
  assignSizeRefs(nodes)
  return nodes
}

describe('assignSizeRefs', () => {
  it('setzt je Art den Median als Bezugsgröße', () => {
    const nodes = korpus()
    expect(nodes.find((n) => n.kind === 'repo')?.sizeRef).toBe(1)
    expect(nodes.find((n) => n.kind === 'task')?.sizeRef).toBe(25)
  })

  it('faellt bei einem Median von 0 auf 1 zurueck, statt durch null zu teilen', () => {
    const nodes = [node('repo', 0), node('repo', 0)]
    assignSizeRefs(nodes)
    expect(nodes[0].sizeRef).toBe(1)
    expect(Number.isFinite(nodeRadius(nodes[0], 1))).toBe(true)
  })
})

describe('nodeRadius', () => {
  it('zeichnet den Median jeder Art gleich gross', () => {
    const nodes = korpus()
    const repoMedian = nodes.find((n) => n.kind === 'repo' && n.val === 1)!
    const taskMedian = nodes.find((n) => n.kind === 'task' && n.val === 25)!
    expect(nodeRadius(repoMedian, 1)).toBeCloseTo(nodeRadius(taskMedian, 1), 5)
  })

  it('haelt die Spannweite unter 1:3 statt bei 1:11', () => {
    const radii = korpus().map((n) => nodeRadius(n, 1))
    expect(Math.max(...radii) / Math.min(...radii)).toBeLessThan(3)
  })

  it('behaelt die Rangfolge innerhalb einer Art', () => {
    const nodes = korpus().filter((n) => n.kind === 'task')
    const radii = nodes
      .sort((a, b) => a.val - b.val)
      .map((n) => nodeRadius(n, 1))
    expect(radii).toEqual([...radii].sort((a, b) => a - b))
    // Und die Extreme fallen wirklich auseinander, sind nicht nur gleich gross.
    expect(radii[radii.length - 1]).toBeGreaterThan(radii[0])
  })

  it('deckelt Ausreisser, statt sie unbegrenzt wachsen zu lassen', () => {
    // Median bleibt 25; beide Ausreisser liegen weit ueber der Deckelung und
    // muessen deshalb gleich gross gezeichnet werden.
    const nodes = [11, 20, 25, 598, 60000].map((v) => node('task', v))
    assignSizeRefs(nodes)
    expect(nodes[2].sizeRef).toBe(25)
    const radii = nodes.map((n) => nodeRadius(n, 1))
    expect(radii[4]).toBeCloseTo(radii[3], 5)
  })

  it('ohne sizeRef bleibt der Radius endlich (Systemknoten aus scene.ts)', () => {
    const kern = node('system', 12, { synthetic: true })
    expect(nodeRadius(kern, 1)).toBeGreaterThan(0)
    expect(Number.isFinite(nodeRadius(kern, 1))).toBe(true)
  })

  it('skaliert linear mit dem Regler', () => {
    const n = korpus()[0]
    expect(nodeRadius(n, 2)).toBeCloseTo(nodeRadius(n, 1) * 2, 5)
  })
})
