/**
 * Szene für den Graph-Explorer: aus dem rohen `/graph`-Payload wird ein Modell mit
 * Clustern, Systemebenen und Aufklapp-Zustand.
 *
 * Bewusst rein (keine React-, keine Canvas-Abhängigkeit), damit Cluster-Bildung,
 * Kollabieren und Detailtiefe testbar bleiben — die Kanten-Semantik des Graphen
 * darf nicht in einer Render-Schleife versteckt entstehen.
 */
import type { Project } from '../../lib/storage'
import { endpointId, KIND_COLORS, type GraphData, type GraphNode, type NodeKind } from '../../types'

export type SceneKind = NodeKind | 'system' | 'project' | 'service'
export type GroupMode = 'kind' | 'cluster'
export type Theme = 'light' | 'dark'

/** Ringe von innen bzw. Ebenen von unten — die Systemschichten der Anwendung. */
export const TIER_LABELS = ['Fundament', 'Wissen', 'Quellen', 'Projekte', 'Dienste'] as const
export const TIER_COUNT = TIER_LABELS.length

export const KIND_TIER: Record<SceneKind, number> = {
  system: 0,
  concept: 1,
  model: 1,
  dataset: 1,
  paper: 2,
  project: 3,
  service: 4,
}

const KIND_LABELS: Record<SceneKind, string> = {
  system: 'Kern',
  concept: 'Konzepte',
  model: 'Modelle',
  dataset: 'Datasets',
  paper: 'Papers',
  project: 'Projekte',
  service: 'Dienste',
}

/** Farben je Knotenart; Wissensarten erben die bestehende Graph-Palette. */
export const SCENE_COLORS: Record<Theme, Record<SceneKind, string>> = {
  light: { ...KIND_COLORS.light, system: '#ea580c', project: '#0d9488', service: '#64748b' },
  dark: { ...KIND_COLORS.dark, system: '#fb923c', project: '#2dd4bf', service: '#94a3b8' },
}

/** Farbkreis für Themen-Cluster (Gruppenmodus „Themen"). */
const CLUSTER_PALETTE: Record<Theme, string[]> = {
  light: [
    '#2563eb', '#d97706', '#dc2626', '#7c3aed', '#059669',
    '#db2777', '#0891b2', '#65a30d', '#9333ea', '#e11d48',
  ],
  dark: [
    '#60a5fa', '#fbbf24', '#f87171', '#a78bfa', '#34d399',
    '#f472b6', '#22d3ee', '#a3e635', '#c084fc', '#fb7185',
  ],
}

/** Externe Dienste und Speicher des Systems — der äußere Ring der Ringansicht. */
export const SERVICES: { id: string; name: string; note: string }[] = [
  { id: 'svc:arxiv', name: 'arXiv', note: 'Korpus-Quelle, Delta-Fetch im Update-Loop' },
  { id: 'svc:mistral', name: 'Mistral EU-API', note: 'Embeddings (mistral-embed) + Chat-Modell' },
  { id: 'svc:s2', name: 'Semantic Scholar', note: 'Zitationsmetriken für Primärquellen' },
  { id: 'svc:pgvector', name: 'Postgres + pgvector', note: 'Chunks, Vektoren, Graph-Tabellen' },
  { id: 'svc:n8n', name: 'n8n', note: 'Cron für den Living-Knowledge-Loop' },
  { id: 'svc:mcp', name: 'MCP-Server', note: 'Agent-Tools auf dem Wissensbestand' },
]

export const SYSTEM_ID = 'sys:kern'
const EPOCH = new Date(0).toISOString()

export interface SceneNode {
  id: string
  kind: SceneKind
  name: string
  status: string
  first_seen: string
  val: number
  citations?: number | null
  landmark?: boolean
  meta: Record<string, unknown>
  /** Cluster-Zugehörigkeit (Gruppen-Id). */
  group: string
  /** Systemschicht: Ring-Index bzw. Ebene. */
  tier: number
  /** Nur bei Hub-Knoten: die zusammengefassten Original-Knoten. */
  members?: string[]
  /** Kern, Projekte, Dienste — kommen nicht aus `/graph`. */
  synthetic?: boolean
  // Laufzeitfelder (force-graph + eigene Layout-Schleife)
  x?: number
  y?: number
  vx?: number
  vy?: number
  fx?: number
  fy?: number
  /** Tiefe 0..1 aus Globus-/Ebenen-Layout — steuert Größe und Deckkraft. */
  depth?: number
  /** Phasenversatz, damit Knoten nicht im Gleichtakt driften. */
  phase?: number
}

export interface SceneLink {
  source: string | SceneNode
  target: string | SceneNode
  relation: string
  weight: number
  status: string
}

export interface SceneGroup {
  id: string
  label: string
  color: string
  tier: number
  count: number
}

export interface Scene {
  nodes: SceneNode[]
  links: SceneLink[]
  groups: SceneGroup[]
}

export const EMPTY_SCENE: Scene = { nodes: [], links: [], groups: [] }

/** So viele Themen-Welten bekommen eine eigene Farbe. */
const MAX_CLUSTERS = 10
const REST_GROUP = 'cluster:rest'
const LABEL_CHARS = 30

/**
 * Namensgeber eines Clusters: das bestvernetzte Konzept — Konzeptnamen lesen sich
 * als Themen ("Retrieval-Augmented Generation"), Papertitel nicht.
 */
function clusterLabel(list: SceneNode[]): string {
  const rank = (n: SceneNode) => (n.kind === 'concept' ? 2 : n.kind === 'model' ? 1 : 0)
  const lead = [...list].sort(
    (a, b) => rank(b) - rank(a) || b.val - a.val || a.name.localeCompare(b.name),
  )[0]
  return lead.name.length > LABEL_CHARS ? `${lead.name.slice(0, LABEL_CHARS - 1)}…` : lead.name
}

function hashPhase(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) % 6283
  return h / 1000
}

// ------------------------------------------------------------------ Cluster

/**
 * Themen-Cluster = Zusammenhangskomponente.
 *
 * Der Korpus ist ein Archipel: 370 Knoten verteilen sich auf ~48 Komponenten rund
 * um je ein bis drei Papers, weil geteilte Konzepte nur bei kanonisch gleichem
 * Namen zusammenfallen (ADR-0012). Label-Propagation zerfiel darauf in Splitter;
 * die Komponente ist die Gruppierung, die den Daten wirklich entspricht.
 * Schlüssel ist die kleinste Knoten-Id der Komponente — deterministisch.
 */
export function connectedComponents(nodes: SceneNode[], links: SceneLink[]): Map<string, string> {
  const neighbours = new Map<string, string[]>(nodes.map((n) => [n.id, []]))
  for (const l of links) {
    const s = endpoint(l.source)
    const t = endpoint(l.target)
    neighbours.get(s)?.push(t)
    neighbours.get(t)?.push(s)
  }
  const label = new Map<string, string>()
  for (const start of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) {
    if (label.has(start.id)) continue
    const stack = [start.id]
    const seen = [start.id]
    label.set(start.id, start.id)
    while (stack.length > 0) {
      const id = stack.pop() as string
      for (const nb of neighbours.get(id) ?? []) {
        if (label.has(nb)) continue
        label.set(nb, start.id)
        seen.push(nb)
        stack.push(nb)
      }
    }
  }
  return label
}

// ------------------------------------------------------------------ Aufbau

export interface BuildOptions {
  theme: Theme
  groupMode: GroupMode
  /** Kern, Projekte und Dienste mitzeichnen (Ring-/Ebenen-Erzählung). */
  showSystem: boolean
  projects?: Project[]
}

/** Rohdaten + lokale Projekte → Szene mit Clustern und Systemschichten. */
export function buildScene(data: GraphData, opts: BuildOptions): Scene {
  const { theme, groupMode, showSystem, projects = [] } = opts
  const palette = CLUSTER_PALETTE[theme]
  const kindColors = SCENE_COLORS[theme]

  const knowledge: SceneNode[] = data.nodes.map((n: GraphNode) => ({
    ...n,
    kind: n.kind as SceneKind,
    group: n.kind,
    tier: KIND_TIER[n.kind],
    phase: hashPhase(n.id),
  }))
  const links: SceneLink[] = data.links.map((l) => ({
    source: endpointId(l.source),
    target: endpointId(l.target),
    relation: l.relation,
    weight: l.weight,
    status: l.status,
  }))

  const groups = new Map<string, SceneGroup>()
  const addGroup = (g: SceneGroup) => groups.set(g.id, g)

  if (groupMode === 'cluster') {
    const label = connectedComponents(knowledge, links)
    const members = new Map<string, SceneNode[]>()
    for (const n of knowledge) {
      const key = label.get(n.id) ?? n.id
      const list = members.get(key)
      if (list) list.push(n)
      else members.set(key, [n])
    }
    // Größte Welt zuerst — eigene Farbe für die dicken Sektoren.
    const ordered = [...members.entries()].sort(
      (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
    )
    const rest: SceneNode[] = []
    ordered.forEach(([key, list], index) => {
      if (index >= MAX_CLUSTERS) {
        rest.push(...list) // Der lange Schwanz kleiner Inseln wird ein Sammelsektor.
        return
      }
      const id = `cluster:${key}`
      for (const n of list) n.group = id
      addGroup({
        id,
        label: clusterLabel(list),
        color: palette[index % palette.length],
        tier: 1,
        count: list.length,
      })
    })
    if (rest.length > 0) {
      for (const n of rest) n.group = REST_GROUP
      addGroup({
        id: REST_GROUP,
        label: 'Weitere Inseln',
        color: kindColors.service,
        tier: 1,
        count: rest.length,
      })
    }
  } else {
    for (const n of knowledge) {
      const existing = groups.get(n.kind)
      if (existing) existing.count += 1
      else
        addGroup({
          id: n.kind,
          label: KIND_LABELS[n.kind],
          color: kindColors[n.kind],
          tier: KIND_TIER[n.kind],
          count: 1,
        })
    }
  }

  if (!showSystem) return { nodes: knowledge, links, groups: [...groups.values()] }

  const systemNodes: SceneNode[] = []
  const systemLinks: SceneLink[] = []

  const core: SceneNode = {
    id: SYSTEM_ID,
    kind: 'system',
    name: 'KWMS-Kern',
    status: 'verified',
    first_seen: EPOCH,
    val: 12,
    meta: { note: 'RAG-Pipeline, Wissens-Graph und Update-Loop' },
    group: 'system',
    tier: 0,
    synthetic: true,
    phase: hashPhase(SYSTEM_ID),
  }
  systemNodes.push(core)
  addGroup({ id: 'system', label: KIND_LABELS.system, color: kindColors.system, tier: 0, count: 1 })

  for (const svc of SERVICES) {
    systemNodes.push({
      id: svc.id,
      kind: 'service',
      name: svc.name,
      status: 'verified',
      first_seen: EPOCH,
      val: 3,
      meta: { note: svc.note },
      group: 'service',
      tier: KIND_TIER.service,
      synthetic: true,
      phase: hashPhase(svc.id),
    })
    systemLinks.push({
      source: SYSTEM_ID,
      target: svc.id,
      relation: 'nutzt',
      weight: 1,
      status: 'verified',
    })
  }
  addGroup({
    id: 'service',
    label: KIND_LABELS.service,
    color: kindColors.service,
    tier: KIND_TIER.service,
    count: SERVICES.length,
  })

  if (projects.length > 0) {
    // Papers kennen ihre Quell-Dokumente — darüber hängen Projekte am echten Wissen.
    const paperByDoc = new Map<string, string[]>()
    for (const n of knowledge) {
      const docs = (n.meta as { source_document_ids?: string[] }).source_document_ids ?? []
      for (const doc of docs) {
        const list = paperByDoc.get(doc)
        if (list) list.push(n.id)
        else paperByDoc.set(doc, [n.id])
      }
    }
    for (const p of projects) {
      const id = `prj:${p.id}`
      systemNodes.push({
        id,
        kind: 'project',
        name: p.name,
        status: 'verified',
        first_seen: new Date(p.createdAt).toISOString(),
        val: 3 + p.documentIds.length,
        meta: {
          note: p.description,
          chats: p.chatIds.length,
          documents: p.documentIds.length,
          projectId: p.id,
        },
        group: 'project',
        tier: KIND_TIER.project,
        synthetic: true,
        phase: hashPhase(id),
      })
      systemLinks.push({
        source: SYSTEM_ID,
        target: id,
        relation: 'enthält',
        weight: 1,
        status: 'verified',
      })
      const seen = new Set<string>()
      for (const doc of p.documentIds) {
        for (const nodeId of paperByDoc.get(doc) ?? []) {
          if (seen.has(nodeId)) continue
          seen.add(nodeId)
          systemLinks.push({
            source: id,
            target: nodeId,
            relation: 'referenziert',
            weight: 1,
            status: 'verified',
          })
        }
      }
    }
    addGroup({
      id: 'project',
      label: KIND_LABELS.project,
      color: kindColors.project,
      tier: KIND_TIER.project,
      count: projects.length,
    })
  }

  // Speichen vom Kern zu den Cluster-Köpfen: gibt Ring- und Ebenenansicht Struktur,
  // ohne den Graphen mit Kanten zu jedem Knoten zu fluten.
  const leadByGroup = new Map<string, SceneNode>()
  for (const n of knowledge) {
    const lead = leadByGroup.get(n.group)
    if (!lead || n.val > lead.val) leadByGroup.set(n.group, n)
  }
  for (const lead of leadByGroup.values()) {
    systemLinks.push({
      source: SYSTEM_ID,
      target: lead.id,
      relation: 'gliedert',
      weight: 1,
      status: 'verified',
    })
  }

  return {
    nodes: [...knowledge, ...systemNodes],
    links: [...links, ...systemLinks],
    groups: [...groups.values()].sort((a, b) => a.tier - b.tier || b.count - a.count),
  }
}

// ------------------------------------------------------------------ Detailtiefe

const DETAIL_FRACTIONS = [0.15, 0.35, 0.6, 0.8, 1] as const

/**
 * Detailtiefe 1..5: behält die bestvernetzten Wissensknoten. Systemknoten und
 * Cluster-Köpfe bleiben immer sichtbar, damit die Struktur nicht zerfällt.
 */
export function applyDetail(scene: Scene, detail: number): Scene {
  const level = Math.min(DETAIL_FRACTIONS.length, Math.max(1, Math.round(detail)))
  const fraction = DETAIL_FRACTIONS[level - 1]
  if (fraction >= 1) return scene

  const knowledge = scene.nodes.filter((n) => !n.synthetic)
  const keep = new Set(scene.nodes.filter((n) => n.synthetic).map((n) => n.id))
  const ranked = [...knowledge].sort((a, b) => b.val - a.val || a.id.localeCompare(b.id))
  const limit = Math.max(1, Math.round(ranked.length * fraction))
  for (const n of ranked.slice(0, limit)) keep.add(n.id)
  // Jede Gruppe behält mindestens ihren Kopf — sonst verschwinden kleine Cluster ganz.
  const leadPerGroup = new Map<string, SceneNode>()
  for (const n of knowledge) {
    const lead = leadPerGroup.get(n.group)
    if (!lead || n.val > lead.val) leadPerGroup.set(n.group, n)
  }
  for (const lead of leadPerGroup.values()) keep.add(lead.id)

  return filterScene(scene, keep)
}

function filterScene(scene: Scene, keep: Set<string>): Scene {
  const nodes = scene.nodes.filter((n) => keep.has(n.id))
  const links = scene.links.filter(
    (l) => keep.has(endpoint(l.source)) && keep.has(endpoint(l.target)),
  )
  const counts = new Map<string, number>()
  for (const n of nodes) counts.set(n.group, (counts.get(n.group) ?? 0) + 1)
  const groups = scene.groups
    .filter((g) => counts.has(g.id))
    .map((g) => ({ ...g, count: counts.get(g.id) ?? 0 }))
  return { nodes, links, groups }
}

export function endpoint(end: string | SceneNode): string {
  return typeof end === 'string' ? end : end.id
}

// ------------------------------------------------------------------ Kollabieren

export const HUB_PREFIX = 'hub:'

/**
 * Kollabierte Gruppen werden zu einem Hub-Knoten zusammengefasst; Kanten wandern
 * auf den Hub und werden dabei aufaddiert (keine Duplikate, keine Selbstkanten).
 */
export function collapseGroups(scene: Scene, collapsed: Set<string>): Scene {
  const active = scene.groups.filter((g) => collapsed.has(g.id))
  if (active.length === 0) return scene

  const hubIdOf = new Map<string, string>()
  const nodes: SceneNode[] = []
  const hubs = new Map<string, SceneNode>()

  for (const n of scene.nodes) {
    if (!collapsed.has(n.group)) {
      nodes.push(n)
      continue
    }
    const hubId = HUB_PREFIX + n.group
    hubIdOf.set(n.id, hubId)
    const hub = hubs.get(hubId)
    if (hub) {
      hub.val += n.val
      hub.members?.push(n.id)
      if (n.landmark) hub.landmark = true
    } else {
      const group = scene.groups.find((g) => g.id === n.group)
      hubs.set(hubId, {
        id: hubId,
        kind: n.kind,
        name: group?.label ?? n.group,
        status: 'verified',
        first_seen: n.first_seen,
        val: n.val,
        meta: {},
        group: n.group,
        tier: group?.tier ?? n.tier,
        members: [n.id],
        landmark: n.landmark,
        phase: hashPhase(hubId),
      })
    }
  }
  nodes.push(...hubs.values())

  const merged = new Map<string, SceneLink>()
  for (const l of scene.links) {
    const s = hubIdOf.get(endpoint(l.source)) ?? endpoint(l.source)
    const t = hubIdOf.get(endpoint(l.target)) ?? endpoint(l.target)
    if (s === t) continue
    const key = s < t ? `${s}|${t}` : `${t}|${s}`
    const existing = merged.get(key)
    if (existing) existing.weight += l.weight
    else merged.set(key, { ...l, source: s, target: t })
  }

  return { nodes, links: [...merged.values()], groups: scene.groups }
}

/** Trefferliste der Suche: Namen (case-insensitiv), inklusive Hub-Mitglieder. */
export function searchMatches(scene: Scene, query: string): Set<string> | null {
  const q = query.trim().toLowerCase()
  if (!q) return null
  const hit = new Set<string>()
  for (const n of scene.nodes) {
    if (n.name.toLowerCase().includes(q)) hit.add(n.id)
  }
  return hit
}
