/**
 * Der Auslöser: Auf dem Globus lagen alle Cluster-Namen übereinander.
 *
 * Jede Gruppe belegt dort einen Längengrad-Sektor und reicht von Pol zu Pol —
 * die bisherige Regel „über den obersten Knoten" traf für alle denselben Punkt.
 * Auf einem Handy war davon nur noch ein farbiger Fleck übrig.
 */
import { describe, expect, it } from 'vitest'
import { globeLabelAnchors, spreadLabels, type DepthNode, type LabelBox } from './labels'

const box = (key: string, x: number, y: number, width = 60): LabelBox => ({ key, x, y, width })

describe('spreadLabels', () => {
  it('lässt in Ruhe, was sich nicht überlappt', () => {
    const items = [box('a', 0, 0), box('b', 200, 0), box('c', 0, 100)]
    expect(spreadLabels(items, 14).map((i) => i.y)).toEqual([0, 0, 100])
  })

  it('schiebt übereinanderliegende Namen auseinander', () => {
    // Genau der Globus-Fall: gleicher Punkt, drei Gruppen.
    const items = [box('a', 0, 0), box('b', 0, 0), box('c', 0, 0)]
    const ys = spreadLabels(items, 14)
      .map((i) => i.y)
      .sort((p, q) => p - q)
    expect(ys).toEqual([0, 14, 28])
  })

  it('weicht nur aus, wo sich die Textkästen waagerecht schneiden', () => {
    const items = [box('a', 0, 0, 40), box('b', 100, 2, 40)]
    // 100 Abstand, zusammen 40 breit — kein Konflikt trotz fast gleicher Höhe.
    expect(spreadLabels(items, 14).map((i) => i.y)).toEqual([0, 2])
  })

  it('löst auch Ketten auf, bei denen das Ausweichen den nächsten trifft', () => {
    const items = [box('a', 0, 0), box('b', 0, 5), box('c', 0, 10)]
    const ys = spreadLabels(items, 14)
      .map((i) => i.y)
      .sort((p, q) => p - q)
    for (let i = 1; i < ys.length; i += 1) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(14)
  })

  it('ist von der Eingabereihenfolge unabhängig', () => {
    const items = [box('a', 0, 0), box('b', 0, 0), box('c', 0, 0)]
    const a = spreadLabels(items, 14).map((i) => `${i.key}:${i.y}`)
    const b = spreadLabels([...items].reverse(), 14).map((i) => `${i.key}:${i.y}`)
    expect(a).toEqual(b)
  })

  it('kommt mit leerer Eingabe zurecht', () => {
    expect(spreadLabels([], 14)).toEqual([])
  })
})

describe('globeLabelAnchors', () => {
  const node = (group: string, x: number, y: number, depth: number): DepthNode => ({
    group,
    x,
    y,
    depth,
  })

  it('folgt dem sichtbaren Teil einer Gruppe', () => {
    // Vorn rechts, hinten links — der Name gehört nach rechts.
    const anchors = globeLabelAnchors([node('g', 100, 0, 1), node('g', -100, 0, 0.1)])
    expect(anchors.get('g')!.x).toBeGreaterThan(0)
  })

  it('übergeht Gruppen, die gerade hinten stehen', () => {
    const anchors = globeLabelAnchors([node('hinten', 0, 0, 0.2), node('vorn', 10, 0, 0.9)])
    expect(anchors.has('hinten')).toBe(false)
    expect(anchors.has('vorn')).toBe(true)
  })

  it('trennt die Gruppen einer gedrehten Kugel voneinander', () => {
    // Drei Sektoren nebeneinander, alle vorn: drei verschiedene Anker.
    const anchors = globeLabelAnchors([
      node('a', -80, 0, 0.9),
      node('b', 0, 0, 1),
      node('c', 80, 0, 0.9),
    ])
    expect(anchors.size).toBe(3)
    expect(anchors.get('a')!.x).toBeLessThan(anchors.get('c')!.x)
  })

  it('lässt erfundene Knoten aus', () => {
    const anchors = globeLabelAnchors([
      { group: 'sys', x: 0, y: 0, depth: 1, synthetic: true },
      node('echt', 5, 5, 1),
    ])
    expect([...anchors.keys()]).toEqual(['echt'])
  })

  it('übergeht Knoten ohne Position', () => {
    const anchors = globeLabelAnchors([{ group: 'g', depth: 1 }, node('g', 10, 10, 1)])
    const a = anchors.get('g')!
    expect(a.x).toBeCloseTo(10, 6)
    expect(a.y).toBeCloseTo(10, 6)
  })

  it('meldet die mittlere Tiefe mit', () => {
    const anchors = globeLabelAnchors([node('g', 0, 0, 1), node('g', 0, 0, 0.8)])
    expect(anchors.get('g')!.depth).toBeCloseTo(0.9, 5)
  })
})
