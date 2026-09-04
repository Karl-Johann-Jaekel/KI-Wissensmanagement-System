import { describe, expect, it } from 'vitest'
import type { GraphData, GraphNode } from '../../../types'
import {
  applyFilter,
  buildHive,
  constellation,
  hexPath,
  hiveLayout,
  keywords,
  mainGroups,
  neighbourSectors,
  nodeSource,
  nodeYear,
  pairKey,
  relationMix,
  relationsOf,
  sectorOfKind,
  sources,
  timeline,
} from './hive'

function node(
  id: string,
  kind: GraphNode['kind'],
  name: string,
  meta: Record<string, unknown> = {},
  extra: Partial<GraphNode> = {},
): GraphNode {
  return {
    id,
    kind,
    name,
    status: 'verified',
    first_seen: '2026-01-01T00:00:00+00:00',
    val: 1,
    meta,
    ...extra,
  }
}

/** Kleiner Bestand: zwei Papers, ein Konzept, ein Dataset, ein Repo. */
function fixture(): GraphData {
  return {
    nodes: [
      node('p1', 'paper', 'Attention Is All You Need', {
        arxiv: '1706.03762',
        uri: 'https://arxiv.org/abs/1706.03762',
        source_document_ids: ['doc-1'],
      }, { val: 4 }),
      node('p2', 'paper', 'Deep Residual Learning', {
        date: '2015-12-10',
        provenance: { source: 'paperswithcode' },
      }, { val: 2, landmark: true }),
      node('c1', 'concept', 'Self-Attention', {}, { val: 3 }),
      node('d1', 'dataset', 'ImageNet', { url: 'https://paperswithcode.com/dataset/imagenet' }),
      node('r1', 'repo', 'google-research/bert', {
        url: 'https://github.com/google-research/bert',
        provenance: { source: 'paperswithcode' },
      }),
    ],
    links: [
      { source: 'p1', target: 'c1', relation: 'INTRODUCES', weight: 1, status: 'verified' },
      { source: 'p2', target: 'd1', relation: 'EVALUATES_ON', weight: 1, status: 'verified' },
      { source: 'r1', target: 'p1', relation: 'IMPLEMENTS', weight: 1, status: 'verified' },
      { source: 'p1', target: 'p2', relation: 'RELATED_TO', weight: 1, status: 'verified' },
    ],
  }
}

describe('sectorOfKind', () => {
  it('bildet die bekannten Arten auf gleichnamige Sektoren ab', () => {
    expect(sectorOfKind('paper')).toBe('paper')
    expect(sectorOfKind('repo')).toBe('repo')
  })

  it('schiebt Unbekanntes zu den Konzepten statt es zu verlieren', () => {
    expect(sectorOfKind('irgendwas')).toBe('concept')
  })
})

describe('nodeYear', () => {
  it('nimmt das ausdrückliche Datum', () => {
    expect(nodeYear({ meta: { date: '2015-12-10' } })).toBe(2015)
    expect(nodeYear({ meta: { published: '2021-03-01T00:00:00Z' } })).toBe(2021)
  })

  it('liest das Jahr aus einer neuen arXiv-Id', () => {
    expect(nodeYear({ meta: { arxiv: '1706.03762' } })).toBe(2017)
    expect(nodeYear({ meta: { arxiv_id: '2401.00123v2' } })).toBe(2024)
  })

  it('liest das Jahr aus einer alten arXiv-Id — 90er sind nicht 2090', () => {
    expect(nodeYear({ meta: { uri: 'https://arxiv.org/abs/cs/0701001' } })).toBe(2007)
    expect(nodeYear({ meta: { uri: 'https://arxiv.org/abs/hep-th/9901001' } })).toBe(1999)
  })

  it('bleibt ohne Datum null, statt eines zu erfinden', () => {
    expect(nodeYear({ meta: {} })).toBeNull()
    expect(nodeYear({ meta: { url: 'https://github.com/foo/bar' } })).toBeNull()
  })
})

describe('nodeSource', () => {
  it('nimmt die Provenienz, auch wenn die URL woanders hinzeigt', () => {
    const meta = {
      provenance: { source: 'paperswithcode' },
      url: 'https://github.com/foo/bar',
    }
    expect(nodeSource({ meta })).toBe('Papers with Code')
  })

  it('fällt ohne Provenienz auf den Host zurück', () => {
    expect(nodeSource({ meta: { url: 'https://github.com/foo/bar' } })).toBe('GitHub')
    expect(nodeSource({ meta: { uri: 'https://arxiv.org/abs/1706.03762' } })).toBe('arXiv')
  })

  it('nennt den eigenen Korpus, wenn nichts hinterlegt ist', () => {
    expect(nodeSource({ meta: {} })).toBe('Eigener Korpus')
  })
})

describe('buildHive', () => {
  it('verteilt die Knoten auf Sektoren und zählt die Kanten je Sektor', () => {
    const hive = buildHive(fixture(), { includeSystem: false })
    const byId = new Map(hive.sectors.map((s) => [s.id, s]))

    expect(byId.get('paper')?.count).toBe(2)
    expect(byId.get('concept')?.count).toBe(1)
    // p1: drei Kanten, p2: zwei — die Paper-Paper-Kante zählt einmal.
    expect(byId.get('paper')?.links).toBe(4)
    expect(byId.get('paper')?.internal).toBe(1)
    expect(byId.get('repo')?.links).toBe(1)
  })

  it('lässt leere Sektoren weg', () => {
    const hive = buildHive(fixture(), { includeSystem: false })
    expect(hive.sectors.map((s) => s.id)).not.toContain('task')
  })

  it('hängt die Infrastruktur-Wabe an, ohne den Graphen zu verändern', () => {
    const hive = buildHive(fixture(), { includeSystem: true })
    const service = hive.sectors.find((s) => s.id === 'service')
    expect(service?.synthetic).toBe(true)
    expect(service?.count).toBeGreaterThan(0)
    expect(hive.stats.nodes).toBe(5) // die Dienste zählen nicht als Graph-Knoten
  })

  it('zählt Kanten zwischen zwei Sektoren genau einmal', () => {
    const hive = buildHive(fixture(), { includeSystem: false })
    expect(hive.between.get(pairKey('paper', 'concept'))).toBe(1)
    expect(hive.between.get(pairKey('repo', 'paper'))).toBe(1)
    expect(hive.between.get(pairKey('paper', 'paper'))).toBeUndefined()
  })

  it('reicht Grad, Jahr und Herkunft an die Knoten durch', () => {
    const hive = buildHive(fixture(), { includeSystem: false })
    const p1 = hive.nodesById.get('p1')
    expect(p1?.degree).toBe(3)
    expect(p1?.year).toBe(2017)
    expect(hive.nodesById.get('r1')?.source).toBe('Papers with Code')
  })

  it('sammelt die belegenden Dokumente je Sektor', () => {
    const hive = buildHive(fixture(), { includeSystem: false })
    expect(hive.sectors.find((s) => s.id === 'paper')?.documentIds).toEqual(['doc-1'])
  })

  it('zählt die Relationstypen absteigend', () => {
    const hive = buildHive(fixture(), { includeSystem: false })
    expect(hive.stats.relations).toBe(4)
    expect(hive.relations).toHaveLength(4)
  })
})

describe('applyFilter', () => {
  it('lässt den Bestand unangetastet, wenn nichts gefiltert wird', () => {
    const data = fixture()
    expect(applyFilter(data, { minDegree: 0, landmarkOnly: false })).toBe(data)
  })

  it('wirft Kanten ins Leere mit weg', () => {
    const out = applyFilter(fixture(), { minDegree: 3, landmarkOnly: false })
    expect(out.nodes.map((n) => n.id)).toEqual(['p1'])
    expect(out.links).toHaveLength(0)
  })

  it('behält nur vielzitierte Knoten', () => {
    const out = applyFilter(fixture(), { minDegree: 0, landmarkOnly: true })
    expect(out.nodes.map((n) => n.id)).toEqual(['p2'])
  })
})

describe('timeline', () => {
  it('füllt Jahreslücken auf und zählt Datumslose getrennt', () => {
    const hive = buildHive(fixture(), { includeSystem: false })
    const papers = hive.sectors.find((s) => s.id === 'paper')!
    const { years, undated } = timeline(papers.nodes)
    expect(years[0].label).toBe('2015')
    expect(years[years.length - 1].label).toBe('2017')
    expect(years).toHaveLength(3) // 2016 bleibt als leerer Balken stehen
    expect(years[1].count).toBe(0)
    expect(undated).toBe(0)
  })

  it('meldet einen Bestand ohne jedes Datum als leer', () => {
    const hive = buildHive(fixture(), { includeSystem: false })
    const concepts = hive.sectors.find((s) => s.id === 'concept')!
    expect(timeline(concepts.nodes)).toEqual({ years: [], undated: 1 })
  })
})

describe('sources', () => {
  it('zählt die Herkunft absteigend', () => {
    const hive = buildHive(fixture(), { includeSystem: false })
    const out = sources([...hive.nodesById.values()])
    expect(out[0]).toEqual({ label: 'Papers with Code', count: 3 })
    expect(Object.fromEntries(out.map((b) => [b.label, b.count]))).toEqual({
      'Papers with Code': 3,
      arXiv: 1,
      'Eigener Korpus': 1,
    })
  })
})

describe('keywords', () => {
  const names = (values: string[]) =>
    buildHive(
      { nodes: values.map((v, i) => node(`n${i}`, 'concept', v)), links: [] },
      { includeSystem: false },
    ).sectors[0].nodes

  it('übergeht Füllwörter und Einzelnennungen', () => {
    const out = keywords(names(['Attention Is All You Need', 'Attention Mechanism']))
    expect(out.map((b) => b.label)).toEqual(['Attention'])
  })

  it('zählt einen Begriff je Knoten nur einmal', () => {
    const out = keywords(names(['Graph Graph Graph Network', 'Graph Network']))
    expect(out).toEqual([
      { label: 'Graph', count: 2 },
      { label: 'Network', count: 2 },
    ])
  })

  it('behält die häufigste Schreibweise', () => {
    const out = keywords(names(['GAN Training', 'GAN Loss', 'gan tricks']))
    expect(out[0].label).toBe('GAN')
  })
})

describe('relationMix und neighbourSectors', () => {
  it('zählt die Relationen an den Knoten eines Sektors', () => {
    const hive = buildHive(fixture(), { includeSystem: false })
    expect(relationMix('concept', hive.links, hive.nodesById)).toEqual([
      { label: 'INTRODUCES', count: 1 },
    ])
  })

  it('ordnet die Nachbarbereiche nach Kantenzahl', () => {
    const hive = buildHive(fixture(), { includeSystem: false })
    const out = neighbourSectors('paper', hive)
    expect(out.map((n) => n.sector.id).sort()).toEqual(['concept', 'dataset', 'repo'])
    expect(out.every((n) => n.count === 1)).toBe(true)
  })
})

describe('relationsOf', () => {
  it('formuliert dieselbe Kante je nach Richtung anders', () => {
    const hive = buildHive(fixture(), { includeSystem: false })
    const fromPaper = relationsOf('p1', hive.links, hive.nodesById)
    const fromConcept = relationsOf('c1', hive.links, hive.nodesById)
    expect(fromPaper.map((g) => g.label)).toContain('führt ein')
    expect(fromConcept.map((g) => g.label)).toEqual(['eingeführt von'])
    expect(fromConcept[0].nodes.map((n) => n.id)).toEqual(['p1'])
  })

  it('nennt kein Gegenüber doppelt', () => {
    const data = fixture()
    data.links.push({
      source: 'p1',
      target: 'c1',
      relation: 'INTRODUCES',
      weight: 1,
      status: 'verified',
    })
    const hive = buildHive(data, { includeSystem: false })
    const groups = relationsOf('p1', hive.links, hive.nodesById)
    expect(groups.find((g) => g.label === 'führt ein')?.nodes).toHaveLength(1)
  })
})

describe('hexPath', () => {
  it('zeichnet ein geschlossenes Sechseck', () => {
    const d = hexPath(0, 0, 10)
    expect(d.endsWith('Z')).toBe(true)
    expect(d.split('L')).toHaveLength(6)
    expect(d.startsWith('M10.00,0.00')).toBe(true)
  })
})

describe('hiveLayout', () => {
  it('legt je Sektor eine Wabe auf den Ring, oben beginnend', () => {
    const layout = hiveLayout(7)
    expect(layout.tiles).toHaveLength(7)
    expect(layout.tiles[0].cx).toBeCloseTo(0, 1)
    expect(layout.tiles[0].cy).toBeLessThan(0)
  })

  it('lässt keine zwei Waben überlappen — bei jeder Sektorzahl', () => {
    // Zwei gleich ausgerichtete Sechsecke berühren sich frühestens bei `2·R`
    // (Umkreis); darunter kann es je nach Richtung schneiden. Der Test prüft
    // alle Paare, nicht nur die Nachbarn: bei kleiner Sektorzahl liegen sich
    // auch übernächste nah.
    for (const count of [3, 4, 5, 6, 7, 8, 9, 12]) {
      const { tiles } = hiveLayout(count)
      for (let i = 0; i < tiles.length; i += 1) {
        for (let j = i + 1; j < tiles.length; j += 1) {
          const d = Math.hypot(tiles[i].cx - tiles[j].cx, tiles[i].cy - tiles[j].cy)
          expect(d).toBeGreaterThanOrEqual(2 * tiles[i].r)
        }
      }
    }
  })

  it('hält die Waben vom Kern fern', () => {
    for (const count of [3, 6, 7, 8, 12]) {
      const layout = hiveLayout(count)
      const ring = Math.hypot(layout.tiles[0].cx, layout.tiles[0].cy)
      expect(ring - layout.tiles[0].r).toBeGreaterThanOrEqual(layout.center.r)
    }
  })

  it('kommt mit einem leeren Bestand zurecht', () => {
    expect(hiveLayout(0).tiles).toEqual([])
  })
})

describe('constellation', () => {
  it('nimmt höchstens `max` Knoten und staffelt sie nach Vernetzung', () => {
    const hive = buildHive(fixture(), { includeSystem: false })
    const all = [...hive.nodesById.values()]
    const points = constellation(all, 100, 3)
    expect(points).toHaveLength(3)
    expect(points[0].size).toBeGreaterThan(points[2].size)
    for (const p of points) expect(Math.hypot(p.x, p.y)).toBeLessThan(100)
  })

  it('bleibt bei leerem Sektor leer', () => {
    expect(constellation([], 100)).toEqual([])
  })
})

describe('mainGroups', () => {
  it('fasst die Knoten eines Sektors zu Hauptgruppen zusammen', () => {
    const hive = buildHive(fixture(), { includeSystem: false })
    const { groups } = mainGroups('paper', hive)
    expect(groups).toHaveLength(1)
    expect(groups[0].count).toBe(2)
    expect(groups[0].label).toBe('Attention Is All You Need')
  })

  it('schweigt, wo jeder Knoten seine eigene Gruppe wäre', () => {
    // Konzepte und Aufgaben sind selbst die Anker der Cluster-Zuordnung; ein
    // Ring aus lauter Einer-Gruppen wäre Rauschen.
    const hive = buildHive(fixture(), { includeSystem: false })
    expect(mainGroups('concept', hive)).toEqual({ groups: [], rest: 0 })
  })

  it('lässt die Systemebene außen vor', () => {
    const hive = buildHive(fixture(), { includeSystem: true })
    expect(mainGroups('service', hive)).toEqual({ groups: [], rest: 0 })
  })
})
