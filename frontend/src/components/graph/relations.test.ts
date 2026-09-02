import { describe, expect, it } from 'vitest'
import { describeRelations, relationCount } from './relations'
import { KIND_TIER, type SceneKind, type SceneLink, type SceneNode } from './scene'

function node(id: string, kind: SceneKind, val = 1): SceneNode {
  return {
    id,
    kind,
    name: id,
    status: 'verified',
    first_seen: '2026-01-01T00:00:00Z',
    val,
    meta: {},
    group: kind,
    tier: KIND_TIER[kind],
  }
}

const NODES = [
  node('paper-a', 'paper', 9),
  node('paper-b', 'paper', 5),
  node('self-attention', 'concept', 7),
  node('wmt', 'dataset', 3),
  node('lstm', 'model', 2),
]
const BY_ID = new Map(NODES.map((n) => [n.id, n]))

const LINKS: SceneLink[] = [
  { source: 'paper-a', target: 'self-attention', relation: 'INTRODUCES', weight: 1, status: 'verified' },
  { source: 'paper-b', target: 'self-attention', relation: 'INTRODUCES', weight: 1, status: 'verified' },
  { source: 'self-attention', target: 'wmt', relation: 'EVALUATES_ON', weight: 1, status: 'verified' },
  { source: 'self-attention', target: 'lstm', relation: 'IMPROVES_ON', weight: 1, status: 'verified' },
]

describe('describeRelations', () => {
  it('formuliert dieselbe Kante je nach Richtung verschieden', () => {
    const vomKonzept = describeRelations('self-attention', LINKS, BY_ID)
    const vomPaper = describeRelations('paper-a', LINKS, BY_ID)

    expect(vomKonzept.find((g) => g.label === 'eingeführt von')?.nodes.map((n) => n.id)).toEqual([
      'paper-a',
      'paper-b',
    ])
    expect(vomPaper.map((g) => g.label)).toEqual(['führt ein'])
  })

  it('sortiert Gruppen nach Umfang und Namen nach Vernetzungsgrad', () => {
    const groups = describeRelations('self-attention', LINKS, BY_ID)
    // "eingeführt von" hat zwei Gegenüber, die anderen je eines.
    expect(groups[0].label).toBe('eingeführt von')
    // Innerhalb der Gruppe zuerst der bestvernetzte Knoten (val 9 vor 5).
    expect(groups[0].nodes[0].id).toBe('paper-a')
    expect(relationCount(groups)).toBe(4)
  })

  it('übergeht Kanten ins Leere', () => {
    // Nach dem Kappen der Knotenmenge zeigen Kanten auf Knoten, die es in der
    // Szene nicht gibt — sie dürfen keine leeren Einträge erzeugen.
    const gekappt = new Map([['self-attention', BY_ID.get('self-attention')!]])
    expect(describeRelations('self-attention', LINKS, gekappt)).toEqual([])
  })

  it('zählt ein Gegenüber je Gruppe nur einmal', () => {
    const doppelt: SceneLink[] = [...LINKS, LINKS[0]]
    const groups = describeRelations('self-attention', doppelt, BY_ID)
    expect(groups.find((g) => g.label === 'eingeführt von')?.nodes).toHaveLength(2)
  })

  it('macht unbekannte Relationen lesbar, statt sie zu verschweigen', () => {
    const exotisch: SceneLink[] = [
      { source: 'self-attention', target: 'wmt', relation: 'TRAINED_ON', weight: 1, status: 'verified' },
    ]
    expect(describeRelations('self-attention', exotisch, BY_ID)[0].label).toBe('trained on')
  })
})
