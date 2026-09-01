import { describe, expect, it } from 'vitest'
import type { Project } from '../../lib/storage'
import type { GraphData } from '../../types'
import {
  applyDetail,
  buildScene,
  collapseGroups,
  clusterAssignment,
  connectedComponents,
  endpoint,
  KIND_TIER,
  searchMatches,
  SERVICES,
  SYSTEM_ID,
  type SceneKind,
  type SceneLink,
  type SceneNode,
} from './scene'

const DATA: GraphData = {
  nodes: [
    {
      id: 'p1',
      kind: 'paper',
      name: 'Attention Is All You Need',
      status: 'verified',
      first_seen: '2026-01-01T00:00:00Z',
      val: 9,
      meta: { source_document_ids: ['doc-1'] },
    },
    {
      id: 'c1',
      kind: 'concept',
      name: 'Transformer',
      status: 'verified',
      first_seen: '2026-01-02T00:00:00Z',
      val: 6,
      meta: {},
    },
    {
      id: 'c2',
      kind: 'concept',
      name: 'RAG',
      status: 'verified',
      first_seen: '2026-01-03T00:00:00Z',
      val: 2,
      meta: {},
    },
    {
      id: 'm1',
      kind: 'model',
      name: 'BERT',
      status: 'pending',
      first_seen: '2026-01-04T00:00:00Z',
      val: 1,
      meta: {},
    },
  ],
  links: [
    { source: 'p1', target: 'c1', relation: 'mentions', weight: 2, status: 'verified' },
    { source: 'p1', target: 'c2', relation: 'mentions', weight: 1, status: 'verified' },
    { source: 'c1', target: 'm1', relation: 'uses', weight: 1, status: 'verified' },
  ],
}

const PROJECT: Project = {
  id: 'prj-1',
  name: 'Literaturarbeit',
  description: 'Vergleich RAG-Varianten',
  chatIds: [],
  documentIds: ['doc-1'],
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
}

describe('buildScene', () => {
  it('gruppiert nach Typ und ergänzt Kern, Dienste und Projekte', () => {
    const scene = buildScene(DATA, {
      theme: 'dark',
      groupMode: 'kind',
      showSystem: true,
      projects: [PROJECT],
    })
    const ids = scene.nodes.map((n) => n.id)
    expect(ids).toContain(SYSTEM_ID)
    expect(ids).toContain('prj:prj-1')
    for (const svc of SERVICES) expect(ids).toContain(svc.id)
    expect(scene.groups.map((g) => g.id)).toEqual(
      expect.arrayContaining(['system', 'concept', 'paper', 'project', 'service']),
    )
    // Systemschichten: Kern innen, Dienste außen.
    expect(scene.nodes.find((n) => n.id === SYSTEM_ID)?.tier).toBe(0)
    expect(scene.nodes.find((n) => n.id === 'svc:arxiv')?.tier).toBe(4)
  })

  it('hängt Projekte über die Quell-Dokumente an echte Knoten', () => {
    const scene = buildScene(DATA, {
      theme: 'dark',
      groupMode: 'kind',
      showSystem: true,
      projects: [PROJECT],
    })
    const link = scene.links.find(
      (l) => endpoint(l.source) === 'prj:prj-1' && endpoint(l.target) === 'p1',
    )
    expect(link?.relation).toBe('referenziert')
  })

  it('lässt die Systemebenen weg, wenn sie abgeschaltet sind', () => {
    const scene = buildScene(DATA, { theme: 'dark', groupMode: 'kind', showSystem: false })
    expect(scene.nodes).toHaveLength(DATA.nodes.length)
    expect(scene.nodes.some((n) => n.synthetic)).toBe(false)
  })

  it('bildet im Themenmodus zusammenhängende Cluster mit Konzeptnamen', () => {
    const scene = buildScene(DATA, { theme: 'dark', groupMode: 'cluster', showSystem: false })
    const groups = new Set(scene.nodes.map((n) => n.group))
    // Alle vier Knoten hängen zusammen — ein Cluster, benannt nach dem Konzept.
    expect(groups.size).toBe(1)
    expect(scene.groups[0].label).toBe('Transformer')
  })

  it('führt vereinzelte Inseln als eigene Gruppe', () => {
    const lonely = { ...DATA.nodes[3], id: 'x1', name: 'Einzelgänger' }
    const scene = buildScene(
      { nodes: [...DATA.nodes, lonely], links: DATA.links },
      { theme: 'dark', groupMode: 'cluster', showSystem: false },
    )
    // Zwei Komponenten: der verbundene Kern und der Einzelgänger.
    expect(scene.groups).toHaveLength(2)
    const island = scene.groups.find((g) => g.count === 1)
    expect(island?.label).toBe('Einzelgänger')
    expect(scene.nodes.find((n) => n.id === 'x1')?.group).toBe(island?.id)
  })
})

describe('connectedComponents', () => {
  const node = (id: string, val: number): SceneNode => ({
    id,
    kind: 'concept',
    name: id,
    status: 'verified',
    first_seen: '2026-01-01T00:00:00Z',
    val,
    meta: {},
    group: 'concept',
    tier: 1,
  })
  const link = (source: string, target: string): SceneLink => ({
    source,
    target,
    relation: 'x',
    weight: 1,
    status: 'verified',
  })

  it('trennt Inseln und hält Verbundenes zusammen', () => {
    const nodes = [node('a', 10), node('a2', 1), node('b', 9), node('b2', 1)]
    const label = connectedComponents(nodes, [link('a', 'a2'), link('b', 'b2')])
    expect(label.get('a')).toBe(label.get('a2'))
    expect(label.get('b')).toBe(label.get('b2'))
    expect(label.get('a')).not.toBe(label.get('b'))
  })

  it('ist deterministisch, auch für Einzelknoten', () => {
    const nodes = [node('a', 10), node('lonely', 1)]
    const first = connectedComponents(nodes, [])
    const second = connectedComponents(nodes, [])
    expect(first.get('lonely')).toBe('lonely')
    expect([...first.entries()]).toEqual([...second.entries()])
  })
})

describe('collapseGroups', () => {
  it('fasst eine Gruppe zu einem Hub zusammen und legt Kanten um', () => {
    const scene = buildScene(DATA, { theme: 'dark', groupMode: 'kind', showSystem: false })
    const collapsed = collapseGroups(scene, new Set(['concept']))
    const hub = collapsed.nodes.find((n) => n.id === 'hub:concept')
    expect(hub?.members).toEqual(['c1', 'c2'])
    expect(hub?.val).toBe(8)
    expect(collapsed.nodes.some((n) => n.id === 'c1')).toBe(false)
    // p1→c1 und p1→c2 werden zu einer Kante mit summiertem Gewicht.
    const merged = collapsed.links.filter(
      (l) => endpoint(l.source) === 'p1' || endpoint(l.target) === 'p1',
    )
    expect(merged).toHaveLength(1)
    expect(merged[0].weight).toBe(3)
  })

  it('lässt die Szene unangetastet, wenn nichts kollabiert ist', () => {
    const scene = buildScene(DATA, { theme: 'dark', groupMode: 'kind', showSystem: false })
    expect(collapseGroups(scene, new Set())).toBe(scene)
  })
})

describe('applyDetail', () => {
  it('behält bei geringer Tiefe die Köpfe jeder Gruppe', () => {
    const scene = buildScene(DATA, { theme: 'dark', groupMode: 'kind', showSystem: true })
    const reduced = applyDetail(scene, 1)
    const ids = reduced.nodes.map((n) => n.id)
    expect(ids).toContain(SYSTEM_ID) // Systemknoten bleiben immer
    expect(ids).toContain('p1')
    expect(ids).toContain('c1') // stärkster Konzept-Knoten
    expect(ids).not.toContain('c2')
    // Kanten ohne beide Endpunkte fallen weg.
    for (const l of reduced.links) {
      expect(ids).toContain(endpoint(l.source))
      expect(ids).toContain(endpoint(l.target))
    }
  })

  it('gibt bei voller Tiefe dieselbe Szene zurück', () => {
    const scene = buildScene(DATA, { theme: 'dark', groupMode: 'kind', showSystem: false })
    expect(applyDetail(scene, 5)).toBe(scene)
  })
})

describe('searchMatches', () => {
  it('findet Namen unabhängig von Groß-/Kleinschreibung', () => {
    const scene = buildScene(DATA, { theme: 'dark', groupMode: 'kind', showSystem: false })
    expect(searchMatches(scene, 'transformer')).toEqual(new Set(['c1']))
    expect(searchMatches(scene, '  ')).toBeNull()
  })
})

/**
 * Fremdquellen-Arten (Papers with Code, ADR-0017): `task` gliedert wie ein Konzept,
 * `repo` belegt wie ein Paper — sie müssen in Ebenen, Farben und Cluster-Namen
 * ankommen, sonst fallen importierte Knoten aus der Erzählung des Explorers.
 */
const PWC: GraphData = {
  nodes: [
    {
      id: 't1',
      kind: 'task',
      name: 'Question Answering',
      status: 'verified',
      first_seen: '2026-08-18T00:00:00Z',
      val: 8,
      meta: { provenance: { source: 'paperswithcode' } },
    },
    {
      id: 'r1',
      kind: 'repo',
      name: 'huggingface/transformers',
      status: 'verified',
      first_seen: '2026-08-18T00:00:00Z',
      val: 4,
      meta: { provenance: { source: 'paperswithcode' } },
    },
    {
      id: 'p9',
      kind: 'paper',
      name: 'RAG',
      status: 'verified',
      first_seen: '2026-08-18T00:00:00Z',
      val: 5,
      meta: {},
    },
  ],
  links: [
    { source: 'r1', target: 'p9', relation: 'IMPLEMENTS', weight: 1, status: 'verified' },
    { source: 'p9', target: 't1', relation: 'RELATED_TO', weight: 1, status: 'verified' },
  ],
}

describe('Fremdquellen-Knotenarten', () => {
  it('legt task auf die Wissens-, repo auf die Quellenebene', () => {
    expect(KIND_TIER.task).toBe(KIND_TIER.concept)
    expect(KIND_TIER.repo).toBe(KIND_TIER.paper)
  })

  it('gibt jeder Art eine eigene Gruppe mit eigener Farbe', () => {
    const scene = buildScene(PWC, { theme: 'dark', groupMode: 'kind', showSystem: false })
    const groups = new Map(scene.groups.map((g) => [g.id, g]))
    expect(groups.get('task')?.label).toBe('Aufgaben')
    expect(groups.get('repo')?.label).toBe('Code')
    const colors = scene.groups.map((g) => g.color)
    expect(new Set(colors).size).toBe(colors.length)
  })

  it('benennt einen Cluster nach der Aufgabe, wenn kein Konzept darin liegt', () => {
    const scene = buildScene(PWC, { theme: 'dark', groupMode: 'cluster', showSystem: false })
    expect(scene.groups.map((g) => g.label)).toContain('Question Answering')
  })

  it('kollabiert eine Fremdquellen-Gruppe wie jede andere', () => {
    const scene = buildScene(PWC, { theme: 'dark', groupMode: 'kind', showSystem: false })
    const hub = collapseGroups(scene, new Set(['repo'])).nodes.find((n) => n.members)
    expect(hub?.name).toBe('Code')
    expect(hub?.members).toEqual(['r1'])
  })
})

/**
 * Cluster-Bildung richtet sich nach der Form der Daten (ADR-0016, ergänzt): Für den
 * dünnen Eigen-Korpus bleibt die Zusammenhangskomponente die ehrliche Gruppierung,
 * für den dichten Graphen nach dem Fremdquellen-Import wäre sie nur noch ein
 * Riesenklumpen — dort zählt das Thema.
 */
function sceneNode(id: string, kind: SceneKind): SceneNode {
  return {
    id,
    kind,
    name: id,
    status: 'verified',
    first_seen: '2026-08-18T00:00:00Z',
    val: 1,
    meta: {},
    group: kind,
    tier: 1,
  }
}

function edge(source: string, target: string): SceneLink {
  return { source, target, relation: 'RELATED_TO', weight: 1, status: 'verified' }
}

/** Ein Klumpen über der Aufteil-Schwelle: zwei Themen, per Brücke verbunden. */
function twoTopicBlob(papersPerTopic = 30): { nodes: SceneNode[]; links: SceneLink[] } {
  const nodes: SceneNode[] = []
  const links: SceneLink[] = []
  for (const topic of ['t-retrieval', 't-vision']) {
    nodes.push(sceneNode(topic, 'task'))
    for (let i = 0; i < papersPerTopic; i += 1) {
      const id = `${topic}-p${i}`
      nodes.push(sceneNode(id, 'paper'))
      links.push(edge(id, topic))
    }
  }
  links.push(edge('t-retrieval-p1', 't-vision-p1'))
  return { nodes, links }
}

describe('clusterAssignment', () => {
  it('bleibt bei Komponenten, solange der Graph ein Archipel ist', () => {
    // Vier getrennte Paare: keine Komponente erreicht die Schwelle.
    const nodes = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => sceneNode(id, 'paper'))
    const links = [edge('a', 'b'), edge('c', 'd'), edge('e', 'f'), edge('g', 'h')]
    const { assignment, labels } = clusterAssignment(nodes, links)
    expect(labels.size).toBe(0) // Komponenten tragen keinen eigenen Namen
    expect(assignment.get('a')).toBe(assignment.get('b'))
    expect(assignment.get('a')).not.toBe(assignment.get('c'))
    expect(new Set(assignment.values()).size).toBe(4)
  })

  it('teilt einen dominanten Klumpen nach Themen auf und benennt sie', () => {
    // Zwei Aufgaben mit je 30 Papers, über eine Brücke verbunden: eine einzige
    // Komponente, groß genug und dominant — genau der Fall nach dem Import.
    const { nodes, links } = twoTopicBlob()
    const { assignment, labels } = clusterAssignment(nodes, links)
    expect(assignment.get('t-retrieval-p0')).toBe(assignment.get('t-retrieval'))
    expect(assignment.get('t-vision-p0')).toBe(assignment.get('t-vision'))
    expect(assignment.get('t-retrieval-p0')).not.toBe(assignment.get('t-vision-p0'))
    expect([...labels.values()].sort()).toEqual(['t-retrieval', 't-vision'])
  })

  it('lässt kleine zusammenhängende Graphen in Ruhe', () => {
    // Unter der absoluten Untergrenze bleibt es bei einer Komponente — ein Graph
    // aus einer Handvoll Knoten zerfasert beim Aufteilen nur.
    const nodes = [sceneNode('t1', 'task'), sceneNode('p1', 'paper'), sceneNode('p2', 'paper')]
    const links = [edge('p1', 't1'), edge('p2', 't1')]
    const { assignment, labels } = clusterAssignment(nodes, links)
    expect(labels.size).toBe(0)
    expect(new Set(assignment.values()).size).toBe(1)
  })

  it('vererbt das Thema an Knoten ohne eigenen Themen-Nachbarn', () => {
    // Ein Code-Repo hängt nur an seinem Paper — ohne Zwischenschritt bliebe es themenlos.
    const { nodes, links } = twoTopicBlob()
    nodes.push(sceneNode('r1', 'repo'))
    links.push(edge('r1', 't-retrieval-p0'))
    const { assignment } = clusterAssignment(nodes, links)
    expect(assignment.get('r1')).toBe(assignment.get('t-retrieval'))
  })

  it('ist deterministisch', () => {
    const { nodes, links } = twoTopicBlob()
    const first = clusterAssignment(nodes, links).assignment
    const second = clusterAssignment(nodes, links).assignment
    expect([...first.entries()]).toEqual([...second.entries()])
  })
})

describe('buildScene im Themen-Modus', () => {
  it('nennt Cluster nach ihrem Thema statt nach dem größten Knoten', () => {
    // Papers tragen hier den höheren `val` — ohne Themennamen würde ein Papertitel
    // zum Clusternamen und die Legende unlesbar.
    const { nodes, links } = twoTopicBlob()
    for (const n of nodes) n.val = n.kind === 'paper' ? 9 : 1
    const data: GraphData = {
      nodes: nodes.map((n) => ({
        id: n.id,
        kind: n.kind as GraphData['nodes'][number]['kind'],
        name: n.id === 't-retrieval' ? 'Question Answering' : n.name,
        status: n.status,
        first_seen: n.first_seen,
        val: n.val,
        meta: {},
      })),
      links: links.map((l) => ({
        source: endpoint(l.source),
        target: endpoint(l.target),
        relation: l.relation,
        weight: l.weight,
        status: l.status,
      })),
    }
    const scene = buildScene(data, { theme: 'dark', groupMode: 'cluster', showSystem: false })
    expect(scene.groups.map((g) => g.label)).toContain('Question Answering')
    expect(scene.groups.length).toBeGreaterThan(1)
  })
})

/**
 * Der Sammelsektor war nach dem Fremdquellen-Import kein Schwanz kleiner Inseln
 * mehr, sondern die Hälfte des Graphen — 1.018 von 2.000 Knoten in einer Farbe.
 */
describe('Sammelsektor', () => {
  function manyTinyIslands(count: number): GraphData {
    const nodes: GraphData['nodes'] = []
    const links: GraphData['links'] = []
    // Zehn Themen, die die Cluster-Plätze belegen …
    for (let t = 0; t < 10; t += 1) {
      nodes.push({
        id: `t${t}`, kind: 'task', name: `Thema ${t}`, status: 'verified',
        first_seen: '2026-08-18T00:00:00Z', val: 5, meta: {},
      })
      for (let p = 0; p < 8; p += 1) {
        nodes.push({
          id: `t${t}p${p}`, kind: 'paper', name: `Paper ${t}-${p}`, status: 'verified',
          first_seen: '2026-08-18T00:00:00Z', val: 1, meta: {},
        })
        links.push({ source: `t${t}p${p}`, target: `t${t}`, relation: 'RELATED_TO', weight: 1, status: 'verified' })
      }
    }
    // … und danach der lange Schwanz: Paare aus je einem Konzept und einem Repo.
    for (let i = 0; i < count; i += 1) {
      nodes.push({
        id: `c${i}`, kind: 'concept', name: `Konzept ${i}`, status: 'verified',
        first_seen: '2026-08-18T00:00:00Z', val: 1, meta: {},
      })
      nodes.push({
        id: `r${i}`, kind: 'repo', name: `repo/${i}`, status: 'verified',
        first_seen: '2026-08-18T00:00:00Z', val: 1, meta: {},
      })
      links.push({ source: `r${i}`, target: `c${i}`, relation: 'IMPLEMENTS', weight: 1, status: 'verified' })
    }
    return { nodes, links }
  }

  it('fächert einen großen Rest nach Knotenart auf', () => {
    const scene = buildScene(manyTinyIslands(120), {
      theme: 'dark', groupMode: 'cluster', showSystem: false,
    })
    const labels = scene.groups.map((g) => g.label)
    expect(labels).toContain('Weitere · Konzepte')
    expect(labels).toContain('Weitere · Code')
    expect(labels).not.toContain('Weitere Inseln')
    // Jeder Knoten landet in genau einer Gruppe.
    const ids = new Set(scene.groups.map((g) => g.id))
    for (const n of scene.nodes) expect(ids.has(n.group)).toBe(true)
  })

  it('lässt einen kleinen Rest als eine Gruppe stehen', () => {
    const scene = buildScene(manyTinyIslands(4), {
      theme: 'dark', groupMode: 'cluster', showSystem: false,
    })
    // Unter der Schwelle wäre die Aufteilung nur Zersplitterung.
    expect(scene.groups.map((g) => g.label)).not.toContain('Weitere · Code')
  })

  it('zählt die aufgefächerten Gruppen vollständig', () => {
    const scene = buildScene(manyTinyIslands(120), {
      theme: 'dark', groupMode: 'cluster', showSystem: false,
    })
    const rest = scene.groups.filter((g) => g.label.startsWith('Weitere · '))
    const counted = rest.reduce((sum, g) => sum + g.count, 0)
    const actual = scene.nodes.filter((n) => n.group.startsWith('cluster:rest:')).length
    expect(counted).toBe(actual)
    expect(counted).toBe(240) // 120 Konzepte + 120 Repos
  })
})
