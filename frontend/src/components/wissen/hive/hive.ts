/**
 * Datenschicht der Wabenansicht.
 *
 * Der Graph-Explorer zeigt den Bestand als Kraftsimulation — gut zum Wandern,
 * schlecht zum Einordnen: wie viel *wovon* im Bestand liegt, aus welcher Quelle
 * es kommt und wie die Bereiche zusammenhängen, liest man aus einer Punktwolke
 * nicht ab. Diese Datei fasst denselben `/graph`-Payload zu Sektoren zusammen
 * (Waben), rechnet je Sektor die Kennzahlen aus und bleibt dabei bewusst rein:
 * kein React, kein Canvas, keine Fetches — damit die Aggregation testbar ist.
 *
 * Alle Zahlen stammen aus der ausgelieferten Antwort. Die ist serverseitig auf
 * `DEFAULT_NODE_LIMIT` Knoten gekappt (Kontingent je Art, `api/graph.py`); die
 * Ansicht muss das benennen statt Vollständigkeit zu behaupten.
 */
import { endpointId, type GraphData, type GraphLink, type GraphNode } from '../../../types'
import {
  clusterAssignment,
  clusterLabel,
  CLUSTER_PALETTE,
  KIND_TIER,
  SCENE_COLORS,
  SERVICES,
  type SceneKind,
  type SceneLink,
  type SceneNode,
} from '../../graph/scene'
import { relationLabel } from '../../graph/relations'

const COLORS = SCENE_COLORS.dark

// ------------------------------------------------------------------ Sektoren

export interface SectorDef {
  id: string
  label: string
  color: string
  /** Was in diesem Sektor liegt — erscheint im Popup als „Beschreibung". */
  blurb: string
}

/**
 * Die festen Sektoren der Wabe. Reihenfolge = Reihenfolge im Ring, im
 * Uhrzeigersinn ab oben; sie ist so gewählt, dass benachbarte Waben auch
 * inhaltlich benachbart sind (Modelle neben Datasets neben Code).
 */
export const SECTOR_DEFS: SectorDef[] = [
  {
    id: 'model',
    label: 'Modelle',
    color: COLORS.model,
    blurb:
      'Benannte Architekturen und Verfahren — von der Einzelvariante bis zur Modellfamilie. Entsteht aus der Extraktion über dem eigenen Korpus und aus den Methoden des Papers-with-Code-Dumps.',
  },
  {
    id: 'dataset',
    label: 'Datasets',
    color: COLORS.dataset,
    blurb:
      'Datensätze und Benchmarks, auf denen die Arbeiten messen. Kanten hierher belegen, woran ein Verfahren tatsächlich geprüft wurde.',
  },
  {
    id: 'repo',
    label: 'Code',
    color: COLORS.repo,
    blurb:
      'Code-Veröffentlichungen zu einer Arbeit. Offizielle Implementierungen wiegen doppelt und liegen deshalb in der Vernetzung vorn (ADR-0017).',
  },
  {
    id: 'service',
    label: 'Infrastruktur',
    color: COLORS.service,
    blurb:
      'Die Dienste hinter dem Bestand: Quellen, Embedding- und Chat-Anbieter, Datenbank, Cron und Agent-Schnittstelle. Systemebene der Anwendung, nicht Teil des Wissensgraphen.',
  },
  {
    id: 'task',
    label: 'Aufgaben',
    color: COLORS.task,
    blurb:
      'Aufgabengebiete („Question Answering", „Object Detection"). Sie gliedern das Wissen quer zu den Papers und liefern in dichten Graphen die Themennamen.',
  },
  {
    id: 'concept',
    label: 'Konzepte',
    color: COLORS.concept,
    blurb:
      'Begriffe, Bausteine und Techniken. Der am dichtesten vernetzte Sektor — Konzepte verbinden Arbeiten, die einander nie zitieren.',
  },
  {
    id: 'paper',
    label: 'Papers',
    color: COLORS.paper,
    blurb:
      'Die Primärquellen. Jede trägt ihre Herkunft; vielzitierte Arbeiten sind als Landmark ausgezeichnet (ADR-0013).',
  },
]

const SECTOR_BY_ID = new Map(SECTOR_DEFS.map((s) => [s.id, s]))

/** Sektor-Id einer Knotenart. Unbekannte Arten fallen auf „Konzepte". */
export function sectorOfKind(kind: string): string {
  return SECTOR_BY_ID.has(kind) ? kind : 'concept'
}

// -------------------------------------------------------------------- Knoten

export interface HiveNode extends GraphNode {
  sector: string
  /**
   * Anliegende Kanten **in der ausgelieferten Antwort**.
   *
   * Nicht dasselbe wie `val`: das zählt der Server über den ganzen Graphen und
   * vor der Kappung. Wer nur eine Teilmenge geliefert bekommt, sieht hier
   * weniger Kanten, als der Knoten wirklich hat — deshalb sortiert und
   * skaliert die Ansicht nach `val` und nennt `degree` getrennt.
   */
  degree: number
  /** Jahr der Erstveröffentlichung, sofern aus den Metadaten ableitbar. */
  year: number | null
  /** Herkunft laut Provenienz bzw. URL-Host. */
  source: string
}

export interface NodeMeta {
  date?: string
  published?: string
  arxiv?: string
  arxiv_id?: string
  uri?: string
  url?: string
  abstract?: string
  note?: string
  framework?: string
  full_name?: string
  is_official?: boolean
  source_document_ids?: string[]
  provenance?: { source?: string; source_url?: string; fetched_at?: string; license?: string }
}

export function nodeMeta(node: { meta: Record<string, unknown> }): NodeMeta {
  return (node.meta ?? {}) as NodeMeta
}

const YEAR_RE = /(?:19|20)\d{2}/
/** Neue arXiv-Id: `YYMM.NNNNN`, wahlweise mit Version (`v2`). */
const ARXIV_NEW_RE = /\b(\d{2})(?:0[1-9]|1[0-2])\.\d{4,5}(?:v\d+)?\b/
/** Alte arXiv-Id: `archiv[.SUB]/YYMMNNN`. */
const ARXIV_OLD_RE = /\b[a-z-]+(?:\.[A-Z]{2})?\/(\d{2})(?:0[1-9]|1[0-2])\d{3}\b/

function yearFromArxiv(raw: string): number | null {
  const modern = ARXIV_NEW_RE.exec(raw)
  if (modern) return 2000 + Number(modern[1])
  const legacy = ARXIV_OLD_RE.exec(raw)
  // Das alte Schema lief 1991–2007; zweistellig heißt 91–99 also nicht 2091.
  if (legacy) {
    const yy = Number(legacy[1])
    return yy >= 91 ? 1900 + yy : 2000 + yy
  }
  return null
}

/**
 * Erstveröffentlichung eines Knotens — **nicht** `first_seen`.
 *
 * `first_seen` sagt, wann der Knoten in *unseren* Bestand kam; für eine
 * Zeitleiste über das Forschungsfeld wäre das der falsche Wert (der
 * Papers-with-Code-Import trug 2015er Arbeiten am selben Tag ein wie 2025er).
 * Reihenfolge der Quellen: ausdrückliches Datum, dann die arXiv-Id, dann die
 * Quell-URL. Findet sich nichts, bleibt der Knoten datumslos — und wird als
 * solcher gezählt statt in ein Ersatzjahr geschoben.
 */
export function nodeYear(node: { meta: Record<string, unknown> }): number | null {
  const meta = nodeMeta(node)
  for (const raw of [meta.date, meta.published]) {
    const hit = raw ? YEAR_RE.exec(raw) : null
    if (hit) return Number(hit[0])
  }
  for (const raw of [meta.arxiv_id, meta.arxiv, meta.uri, meta.url]) {
    const year = raw ? yearFromArxiv(raw) : null
    if (year) return year
  }
  return null
}

const SOURCE_LABELS: Record<string, string> = {
  paperswithcode: 'Papers with Code',
  arxiv: 'arXiv',
  semanticscholar: 'Semantic Scholar',
}

const HOST_LABELS: [RegExp, string][] = [
  [/arxiv\.org/i, 'arXiv'],
  [/github\.com/i, 'GitHub'],
  [/gitlab\.com/i, 'GitLab'],
  [/huggingface\.co/i, 'Hugging Face'],
  [/paperswithcode\.com/i, 'Papers with Code'],
]

/**
 * Herkunft eines Knotens.
 *
 * Die Provenienz gewinnt: sie sagt, *woher wir die Aussage haben*. Erst ohne sie
 * entscheidet der Host der Quell-URL, und bleibt auch der stumm, stammt der
 * Knoten aus der eigenen Extraktion über dem arXiv-Korpus.
 */
export function nodeSource(node: { meta: Record<string, unknown> }): string {
  const meta = nodeMeta(node)
  const declared = meta.provenance?.source
  if (declared) return SOURCE_LABELS[declared] ?? declared
  const url = meta.uri ?? meta.url ?? ''
  for (const [re, label] of HOST_LABELS) if (re.test(url)) return label
  return 'Eigener Korpus'
}

// -------------------------------------------------------------------- Sektor

export interface Sector extends SectorDef {
  /** Absteigend nach Vernetzung. */
  nodes: HiveNode[]
  count: number
  /** Anliegende Kanten insgesamt. */
  links: number
  /** Kanten, deren beide Enden in diesem Sektor liegen. */
  internal: number
  /** Dokument-Ids, die Knoten dieses Sektors belegen. */
  documentIds: string[]
  /** Sektor der Systemebene (Infrastruktur) — nicht aus `/graph`. */
  synthetic: boolean
}

export interface HiveStats {
  nodes: number
  links: number
  documents: number
  sectors: number
  relations: number
}

export interface Hive {
  sectors: Sector[]
  stats: HiveStats
  /** Kantenzahl zwischen zwei Sektoren; Schlüssel `a|b` mit a ≤ b. */
  between: Map<string, number>
  nodesById: Map<string, HiveNode>
  links: GraphLink[]
  /** Relationstypen im Bestand, absteigend nach Häufigkeit. */
  relations: { relation: string; count: number }[]
}

export function pairKey(a: string, b: string): string {
  return a <= b ? `${a}|${b}` : `${b}|${a}`
}

/** Die Infrastruktur-Wabe: feste Dienste der Anwendung, keine Graph-Knoten. */
function serviceNodes(): HiveNode[] {
  return SERVICES.map((svc, index) => ({
    id: svc.id,
    kind: 'concept' as GraphNode['kind'],
    name: svc.name,
    status: 'verified',
    first_seen: new Date(0).toISOString(),
    val: SERVICES.length - index,
    meta: { note: svc.note },
    sector: 'service',
    degree: 0,
    year: null,
    source: 'Systemebene',
  }))
}

export interface HiveOptions {
  /** Zahl der Dokumente im Bestand (aus `/documents`). */
  documents?: number
  /** Infrastruktur-Wabe mitzeichnen. */
  includeSystem?: boolean
}

/** `/graph`-Payload → Sektoren mit Kennzahlen. */
export function buildHive(data: GraphData, opts: HiveOptions = {}): Hive {
  const { documents = 0, includeSystem = true } = opts

  const degree = new Map<string, number>()
  for (const link of data.links) {
    const s = endpointId(link.source)
    const t = endpointId(link.target)
    degree.set(s, (degree.get(s) ?? 0) + 1)
    degree.set(t, (degree.get(t) ?? 0) + 1)
  }

  const nodes: HiveNode[] = data.nodes.map((n) => ({
    ...n,
    sector: sectorOfKind(n.kind),
    degree: degree.get(n.id) ?? 0,
    year: nodeYear(n),
    source: nodeSource(n),
  }))
  const nodesById = new Map(nodes.map((n) => [n.id, n]))

  const buckets = new Map<string, HiveNode[]>()
  for (const n of nodes) {
    const list = buckets.get(n.sector)
    if (list) list.push(n)
    else buckets.set(n.sector, [n])
  }
  if (includeSystem) {
    const svc = serviceNodes()
    buckets.set('service', svc)
    for (const n of svc) nodesById.set(n.id, n)
  }

  const incident = new Map<string, number>()
  const internal = new Map<string, number>()
  const between = new Map<string, number>()
  const relations = new Map<string, number>()
  for (const link of data.links) {
    relations.set(link.relation, (relations.get(link.relation) ?? 0) + 1)
    const a = nodesById.get(endpointId(link.source))?.sector
    const b = nodesById.get(endpointId(link.target))?.sector
    if (!a || !b) continue
    incident.set(a, (incident.get(a) ?? 0) + 1)
    if (a === b) {
      internal.set(a, (internal.get(a) ?? 0) + 1)
    } else {
      incident.set(b, (incident.get(b) ?? 0) + 1)
      const key = pairKey(a, b)
      between.set(key, (between.get(key) ?? 0) + 1)
    }
  }

  const sectors: Sector[] = SECTOR_DEFS.flatMap((def) => {
    const list = buckets.get(def.id)
    if (!list || list.length === 0) return []
    const docs = new Set<string>()
    for (const n of list) for (const id of nodeMeta(n).source_document_ids ?? []) docs.add(id)
    return [
      {
        ...def,
        nodes: [...list].sort((a, b) => b.val - a.val || a.name.localeCompare(b.name)),
        count: list.length,
        links: incident.get(def.id) ?? 0,
        internal: internal.get(def.id) ?? 0,
        documentIds: [...docs],
        synthetic: def.id === 'service',
      },
    ]
  })

  return {
    sectors,
    stats: {
      nodes: data.nodes.length,
      links: data.links.length,
      documents,
      sectors: sectors.length,
      relations: relations.size,
    },
    between,
    nodesById,
    links: data.links,
    relations: [...relations.entries()]
      .map(([relation, count]) => ({ relation, count }))
      .sort((a, b) => b.count - a.count || a.relation.localeCompare(b.relation)),
  }
}

// -------------------------------------------------------------------- Filter

export interface HiveFilter {
  /** Mindestzahl anliegender Kanten. */
  minDegree: number
  /** Nur vielzitierte Primärquellen (`landmark`). */
  landmarkOnly: boolean
}

export const DEFAULT_FILTER: HiveFilter = { minDegree: 0, landmarkOnly: false }

/**
 * Filter auf den Rohdaten anwenden — Kanten ins Leere fallen mit weg.
 *
 * Bewusst vor `buildHive`: sonst zeigten die Sektor-Kennzahlen einen Bestand,
 * den die Wabe gar nicht darstellt.
 */
export function applyFilter(data: GraphData, filter: HiveFilter): GraphData {
  if (filter.minDegree <= 0 && !filter.landmarkOnly) return data
  const degree = new Map<string, number>()
  for (const link of data.links) {
    const s = endpointId(link.source)
    const t = endpointId(link.target)
    degree.set(s, (degree.get(s) ?? 0) + 1)
    degree.set(t, (degree.get(t) ?? 0) + 1)
  }
  const nodes = data.nodes.filter(
    (n) =>
      (degree.get(n.id) ?? 0) >= filter.minDegree && (!filter.landmarkOnly || n.landmark === true),
  )
  const ids = new Set(nodes.map((n) => n.id))
  const links = data.links.filter(
    (l) => ids.has(endpointId(l.source)) && ids.has(endpointId(l.target)),
  )
  return { nodes, links }
}

// -------------------------------------------------------------- Auswertungen

export interface Bucket {
  label: string
  count: number
  color?: string
}

/**
 * Jahresverteilung der Erstveröffentlichungen.
 *
 * `undated` steht daneben statt in einem Sammeljahr: Knoten ohne Datum sind bei
 * Konzepten die Regel, und ein Balken „ohne Jahr" würde die Kurve verzerren.
 */
export function timeline(nodes: HiveNode[]): { years: Bucket[]; undated: number } {
  const counts = new Map<number, number>()
  let undated = 0
  for (const n of nodes) {
    if (n.year === null) undated += 1
    else counts.set(n.year, (counts.get(n.year) ?? 0) + 1)
  }
  const years = [...counts.keys()].sort((a, b) => a - b)
  if (years.length === 0) return { years: [], undated }
  // Lückenlos auffüllen, damit ein Balken ein Jahr bedeutet und Lücken sichtbar
  // bleiben, statt vom Nachbarjahr überdeckt zu werden.
  const out: Bucket[] = []
  for (let y = years[0]; y <= years[years.length - 1]; y += 1) {
    out.push({ label: String(y), count: counts.get(y) ?? 0 })
  }
  return { years: out, undated }
}

/** Herkunft der Knoten, absteigend. */
export function sources(nodes: HiveNode[]): Bucket[] {
  const counts = new Map<string, number>()
  for (const n of nodes) counts.set(n.source, (counts.get(n.source) ?? 0) + 1)
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

/**
 * Füllwörter beider Sprachen plus die Bausteine, die in Papertiteln überall
 * stehen und deshalb nichts unterscheiden („novel", „towards").
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'for', 'and', 'or', 'with', 'on', 'in', 'to', 'via', 'from', 'by',
  'at', 'as', 'is', 'are', 'we', 'our', 'its', 'their', 'this', 'that', 'these', 'those',
  'using', 'used', 'use', 'based', 'towards', 'toward', 'novel', 'new', 'approach', 'method',
  'methods', 'framework', 'improved', 'efficient', 'end', 'over', 'into',
  'und', 'oder', 'der', 'die', 'das', 'ein', 'eine', 'für', 'mit', 'von', 'zur', 'zum',
])

/**
 * Häufige Begriffe in den Knotennamen dieses Sektors.
 *
 * Keine Themenerkennung, sondern schlicht Wortzählung — sie beschreibt, *wie im
 * Bestand geredet wird*, und ist in der Oberfläche als solche beschriftet. Je
 * Knoten zählt ein Begriff einmal, sonst gewinnt ein einzelner langer Name; die
 * häufigste Schreibweise gewinnt, damit „GAN" nicht als „gan" erscheint.
 */
export function keywords(nodes: HiveNode[], limit = 12): Bucket[] {
  const counts = new Map<string, number>()
  const surfaces = new Map<string, Map<string, number>>()
  for (const n of nodes) {
    const seen = new Set<string>()
    for (const raw of n.name.split(/[^\p{L}\p{N}+#-]+/u)) {
      const token = raw.replace(/^[-+]+|[-+]+$/g, '')
      if (token.length < 3) continue
      const key = token.toLowerCase()
      if (STOPWORDS.has(key) || /^\d+$/.test(key) || seen.has(key)) continue
      seen.add(key)
      counts.set(key, (counts.get(key) ?? 0) + 1)
      const forms = surfaces.get(key) ?? new Map<string, number>()
      forms.set(token, (forms.get(token) ?? 0) + 1)
      surfaces.set(key, forms)
    }
  }
  const best = (key: string): string => {
    const forms = [...(surfaces.get(key) ?? new Map<string, number>()).entries()]
    forms.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    return forms[0]?.[0] ?? key
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => ({ label: best(key), count }))
}

/** Relationstypen an den Knoten eines Sektors, absteigend. */
export function relationMix(
  sectorId: string,
  links: GraphLink[],
  nodesById: Map<string, HiveNode>,
): Bucket[] {
  const counts = new Map<string, number>()
  for (const link of links) {
    const a = nodesById.get(endpointId(link.source))?.sector
    const b = nodesById.get(endpointId(link.target))?.sector
    if (a !== sectorId && b !== sectorId) continue
    counts.set(link.relation, (counts.get(link.relation) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

/** Verbindungen eines Sektors zu den übrigen, absteigend. */
export function neighbourSectors(sectorId: string, hive: Hive): { sector: Sector; count: number }[] {
  return hive.sectors
    .filter((s) => s.id !== sectorId)
    .map((s) => ({ sector: s, count: hive.between.get(pairKey(sectorId, s.id)) ?? 0 }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count || a.sector.label.localeCompare(b.sector.label))
}

// --------------------------------------------------------------- Hauptgruppen

export interface ClusterBucket extends Bucket {
  id: string
  members: HiveNode[]
}

function toSceneNodes(nodes: HiveNode[]): SceneNode[] {
  return nodes.map((n) => ({
    ...n,
    kind: n.kind as SceneKind,
    group: n.kind,
    tier: KIND_TIER[n.kind as SceneKind] ?? 1,
  }))
}

/**
 * Hauptgruppen eines Sektors — dieselbe Cluster-Zuordnung wie im Graph-Explorer
 * (`scene.ts`), damit „Retrieval" hier nicht anders geschnitten ist als dort.
 *
 * Gerechnet wird über den **ganzen** Graphen und erst danach auf den Sektor
 * eingeschränkt: Ein Konzept gehört zu einem Thema wegen seiner Papers, nicht
 * wegen der anderen Konzepte.
 */
export function mainGroups(
  sectorId: string,
  hive: Hive,
  limit = 5,
): { groups: ClusterBucket[]; rest: number } {
  const sector = hive.sectors.find((s) => s.id === sectorId)
  if (!sector || sector.synthetic) return { groups: [], rest: 0 }

  const all = toSceneNodes([...hive.nodesById.values()].filter((n) => n.sector !== 'service'))
  const links: SceneLink[] = hive.links.map((l) => ({
    source: endpointId(l.source),
    target: endpointId(l.target),
    relation: l.relation,
    weight: l.weight,
    status: l.status,
  }))
  const { assignment, labels } = clusterAssignment(all, links)

  const members = new Map<string, HiveNode[]>()
  for (const node of sector.nodes) {
    const key = assignment.get(node.id)
    if (!key) continue
    const list = members.get(key)
    if (list) list.push(node)
    else members.set(key, [node])
  }
  const ordered = [...members.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  )
  // Konzepte und Aufgaben *sind* die Themenanker der Cluster-Zuordnung: jeder
  // von ihnen wird sein eigener Cluster, und ein Ring aus 69 Einer-Gruppen sagt
  // nichts. Ohne eine Gruppe mit mindestens zwei Knoten gibt es hier nichts zu
  // zeigen — die Oberfläche schreibt dann hin, warum.
  if ((ordered[0]?.[1].length ?? 0) < 2) return { groups: [], rest: 0 }
  const palette = CLUSTER_PALETTE.dark
  const groups = ordered.slice(0, limit).map(([id, list], index) => ({
    id,
    // Themen-Cluster kennen ihren Namen; sonst benennt sie ihr Leitknoten.
    label: labels.get(id) ?? clusterLabel(toSceneNodes(list)),
    count: list.length,
    color: palette[index % palette.length],
    members: [...list].sort((a, b) => b.val - a.val),
  }))
  const rest = ordered.slice(limit).reduce((sum, [, list]) => sum + list.length, 0)
  return { groups, rest }
}

/**
 * Beziehungen eines Knotens, nach Formulierung gruppiert.
 *
 * Die Wortwahl kommt aus `relations.ts` — dieselbe Kante darf hier nicht anders
 * heißen als in der Leseansicht des Graph-Explorers. Die Gruppierung läuft
 * dagegen direkt über `GraphLink`, statt den Bestand erst in Szenen-Knoten zu
 * überführen: Das wären bei jeder Auswahl zweitausend Objekte für ein Panel.
 */
export function relationsOf(
  nodeId: string,
  links: GraphLink[],
  nodesById: Map<string, HiveNode>,
): { label: string; nodes: HiveNode[] }[] {
  const groups = new Map<string, HiveNode[]>()
  for (const link of links) {
    const source = endpointId(link.source)
    const target = endpointId(link.target)
    if (source !== nodeId && target !== nodeId) continue
    const outgoing = source === nodeId
    const other = nodesById.get(outgoing ? target : source)
    if (!other || other.id === nodeId) continue
    const label = relationLabel(link.relation, outgoing)
    const list = groups.get(label)
    if (list) {
      if (!list.some((n) => n.id === other.id)) list.push(other)
    } else {
      groups.set(label, [other])
    }
  }
  return [...groups.entries()]
    .map(([label, nodes]) => ({
      label,
      nodes: [...nodes].sort((a, b) => b.val - a.val || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.nodes.length - a.nodes.length || a.label.localeCompare(b.label))
}

// ----------------------------------------------------------------- Geometrie

export interface HexPlacement {
  cx: number
  cy: number
  r: number
  /** Winkel vom Zentrum in Grad — für die Verbindungslinie. */
  angle: number
}

export interface HiveLayout {
  tiles: HexPlacement[]
  center: { cx: number; cy: number; r: number }
  viewBox: string
  extent: number
}

/** Pfad einer Wabe mit flacher Oberkante (Ecke links und rechts). */
export function hexPath(cx: number, cy: number, r: number): string {
  const points: string[] = []
  for (let i = 0; i < 6; i += 1) {
    const a = (Math.PI / 180) * (60 * i)
    points.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`)
  }
  return `M${points.join('L')}Z`
}

const TILE_R = 100

/**
 * Mindestabstand benachbarter Wabenmittelpunkte, in Vielfachen von `TILE_R`.
 *
 * Zwei gleich ausgerichtete Sechsecke überschneiden sich genau dann nicht, wenn
 * ihre Mittelpunkte mindestens `2·r(φ)` auseinanderliegen — und `r(φ)`, der
 * Abstand vom Mittelpunkt zum Rand, schwankt je nach Richtung zwischen der
 * Apothem-Länge (0,87·R) und dem Umkreis (R). Auf einem Ring zeigt jede
 * Nachbarschaft in eine andere Richtung; welche Richtung getroffen wird, hängt
 * an der Sektorzahl. Das Layout rechnet deshalb mit dem ungünstigsten Fall
 * (`2·R`) und legt Luft dazu — das gilt dann für jede Sektorzahl.
 *
 * Der frühere Wert war `√3` (Kante an Kante im Wabengitter). Der stimmt nur,
 * wenn beide Waben *im Gitter* benachbart liegen; auf einem Siebenerring taten
 * sie das nicht, und Papers und Modelle überlappten sichtbar.
 */
const NEIGHBOUR_GAP = 2.16

/** Damit der Ring dem Kern nie zu nah kommt, auch bei wenigen Sektoren. */
const MIN_RING = 2.14

/** Anteil des Ringradius, den die Kernwabe einnimmt. */
const CENTER_SHARE = 0.46

/**
 * Ringanordnung der Waben, oben beginnend im Uhrzeigersinn.
 *
 * Bei N Sektoren liegen benachbarte Mittelpunkte `2·R_ring·sin(π/N)`
 * auseinander; der Ring wächst so weit, bis das `NEIGHBOUR_GAP` erreicht. Der
 * Kern wächst mit, sonst risse mit steigender Sektorzahl ein Loch in die Mitte.
 */
export function hiveLayout(count: number): HiveLayout {
  if (count === 0) {
    return {
      tiles: [],
      center: { cx: 0, cy: 0, r: TILE_R * 0.9 },
      viewBox: '-200 -200 400 400',
      extent: 200,
    }
  }
  const ring = Math.max(
    (NEIGHBOUR_GAP * TILE_R) / (2 * Math.sin(Math.PI / count)),
    MIN_RING * TILE_R,
  )
  const center = { cx: 0, cy: 0, r: Math.round(ring * CENTER_SHARE) }
  const tiles: HexPlacement[] = []
  for (let i = 0; i < count; i += 1) {
    const angle = -90 + (360 / count) * i
    const rad = (Math.PI / 180) * angle
    tiles.push({
      cx: Math.round(ring * Math.cos(rad) * 100) / 100,
      cy: Math.round(ring * Math.sin(rad) * 100) / 100,
      r: TILE_R,
      angle,
    })
  }
  // Rand für Beschriftung und Leuchten.
  const extent = Math.round(ring + TILE_R + 34)
  return { tiles, center, viewBox: `${-extent} ${-extent} ${extent * 2} ${extent * 2}`, extent }
}

export interface ConstellationPoint {
  node: HiveNode
  x: number
  y: number
  size: number
}

/**
 * Miniatur-Konstellation im Inneren einer Wabe: eine Nabe, darum die
 * bestvernetzten Knoten des Sektors auf einem Kreis. Die Punktgröße folgt der
 * Wurzel der Vernetzung — linear erschlüge der Spitzenknoten alle anderen.
 */
export function constellation(nodes: HiveNode[], r: number, max = 7): ConstellationPoint[] {
  const picked = nodes.slice(0, max)
  if (picked.length === 0) return []
  // Zwischen Kopfzeile (y ≈ -40) und Fußzeile (y ≈ 68) bleiben rund 45 Einheiten
  // nach oben; ein weiterer Kranz liefe in den Sektornamen.
  const orbit = r * 0.42
  const top = picked[0].val || 1
  return picked.map((node, index) => {
    const angle = (Math.PI * 2 * index) / picked.length - Math.PI / 2
    // Leichter Versatz, damit der Kranz nicht wie ein Zifferblatt wirkt.
    const wobble = 1 - ((index * 37) % 5) / 26
    return {
      node,
      x: Math.round(Math.cos(angle) * orbit * wobble * 100) / 100,
      y: Math.round(Math.sin(angle) * orbit * wobble * 100) / 100,
      size: Math.round((3.4 + 5.2 * Math.sqrt(Math.min(1, node.val / top))) * 100) / 100,
    }
  })
}
