/**
 * Das Sektor-Popup: alles, was der Bestand über einen Bereich hergibt, in sechs
 * Reitern.
 *
 * Die Wabe selbst zeigt zwei Zahlen — hier steht, woraus sie bestehen: welche
 * Hauptgruppen den Bereich tragen, aus welchen Quellen er stammt, wie er sich
 * über die Jahre verteilt, welche Dokumente ihn belegen und woran er hängt.
 * Jede Zahl stammt aus der ausgelieferten `/graph`-Antwort; nichts wird
 * hochgerechnet.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  Download,
  ExternalLink,
  FileText,
  Layers,
  Network,
  Share2,
  X,
} from 'lucide-react'
import type { DocumentRow } from '../../../api'
import { relationLabel } from '../../graph/relations'
import { cn } from '../../../lib/cn'
import Badge from '../../ui/Badge'
import Button from '../../ui/Button'
import Modal from '../../ui/Modal'
import { Bars, Donut, Meter } from './Charts'
import {
  keywords,
  mainGroups,
  neighbourSectors,
  nodeMeta,
  relationMix,
  sources,
  timeline,
  type Hive,
  type HiveNode,
  type Sector,
} from './hive'

type Tab = 'overview' | 'nodes' | 'links' | 'docs' | 'clusters' | 'time'

interface Props {
  sector: Sector
  hive: Hive
  documents: DocumentRow[]
  onClose: () => void
  onPickNode: (node: HiveNode) => void
  /** Wechselt in den Graph-Explorer (Reiter „Graph"). */
  onOpenGraph: () => void
}

/** Wie viele Knoten die Liste zeigt, bevor nachgeladen wird. */
const PAGE = 60

function Stat({ icon: Icon, value, label, color }: {
  icon: typeof Layers
  value: string
  label: string
  color: string
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon className="h-4 w-4 shrink-0" style={{ color }} />
      <div className="min-w-0">
        <div className="text-lg font-semibold leading-none tabular-nums text-ink">{value}</div>
        <div className="mt-1 text-[10px] uppercase tracking-wider text-muted">{label}</div>
      </div>
    </div>
  )
}

function Section({ title, children, className }: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('rounded-xl border border-edge bg-canvas/60 p-3.5', className)}>
      <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
        {title}
      </h3>
      {children}
    </section>
  )
}

function NodeRow({ node, color, onPick }: {
  node: HiveNode
  color: string
  onPick: (node: HiveNode) => void
}) {
  const meta = nodeMeta(node)
  return (
    <button
      onClick={() => onPick(node)}
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-sunken"
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: node.landmark ? '#fbbf24' : color }}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs text-ink" title={node.name}>
          {node.name}
        </span>
        <span className="block truncate text-[10px] text-muted">
          {[meta.full_name && meta.full_name !== node.name ? meta.full_name : null, node.source]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </span>
      {/* Ohne Jahr entfällt die Spalte, statt einen Gedankenstrich zu setzen:
          bei Modellen und Begriffen wäre sonst jede Zeile mit einem beginnt. */}
      <span
        className="shrink-0 text-[10px] tabular-nums text-muted"
        title={
          node.year
            ? `${node.year} · Vernetzung ${Math.round(node.val)} (${node.degree} Kanten hier)`
            : `Vernetzung ${Math.round(node.val)} (${node.degree} Kanten hier)`
        }
      >
        {node.year ? `${node.year} · ` : ''}
        {Math.round(node.val)}
      </span>
    </button>
  )
}

export default function SectorModal({
  sector,
  hive,
  documents,
  onClose,
  onPickNode,
  onOpenGraph,
}: Props) {
  const [tab, setTab] = useState<Tab>('overview')
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(PAGE)

  const docs = useMemo(() => {
    const ids = new Set(sector.documentIds)
    return documents.filter((d) => ids.has(d.id))
  }, [sector, documents])

  const groups = useMemo(() => mainGroups(sector.id, hive), [sector, hive])
  const years = useMemo(() => timeline(sector.nodes), [sector])
  const srcs = useMemo(() => sources(sector.nodes), [sector])
  const words = useMemo(() => keywords(sector.nodes), [sector])
  const neighbours = useMemo(() => neighbourSectors(sector.id, hive), [sector, hive])
  const relations = useMemo(
    () => relationMix(sector.id, hive.links, hive.nodesById),
    [sector, hive],
  )
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? sector.nodes.filter((n) => n.name.toLowerCase().includes(q)) : sector.nodes
  }, [sector, query])

  /** Sektor als JSON sichern — dieselben Zahlen, nur ohne Oberfläche darum. */
  const exportSector = () => {
    const payload = {
      sector: sector.id,
      label: sector.label,
      exported_at: new Date().toISOString(),
      counts: { nodes: sector.count, links: sector.links, internal_links: sector.internal },
      nodes: sector.nodes.map((n) => ({
        id: n.id,
        name: n.name,
        kind: n.kind,
        year: n.year,
        source: n.source,
        degree: n.degree,
        val: n.val,
        citations: n.citations ?? null,
      })),
    }
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    )
    const a = document.createElement('a')
    a.href = url
    a.download = `wissensbasis-${sector.id}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Übersicht' },
    { id: 'nodes', label: `Knoten (${sector.count.toLocaleString('de-DE')})` },
    { id: 'links', label: 'Verbindungen' },
    { id: 'docs', label: `Dokumente (${docs.length})` },
    { id: 'clusters', label: 'Cluster' },
    { id: 'time', label: 'Zeitleiste' },
  ]

  const header = (
    <div className="shrink-0 border-b border-edge">
      <div
        className="flex items-center gap-3 px-5 py-3.5"
        style={{
          background: `linear-gradient(90deg, ${sector.color}1f 0%, transparent 55%)`,
        }}
      >
        <button
          onClick={onClose}
          aria-label="Zurück zur Wabenstruktur"
          className="rounded-lg p-1.5 text-muted transition-colors hover:bg-sunken hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h2
            className="truncate text-lg font-semibold uppercase tracking-[0.12em]"
            style={{ color: sector.color }}
          >
            {sector.label}
          </h2>
          <p className="text-[11px] tabular-nums text-muted">
            {sector.count.toLocaleString('de-DE')} Knoten ·{' '}
            {sector.links.toLocaleString('de-DE')} Kanten
            {sector.synthetic && ' · Systemebene'}
          </p>
        </div>
        <Button variant="secondary" size="sm" icon={Network} onClick={onOpenGraph}>
          <span className="hidden sm:inline">Im Graph ansehen</span>
        </Button>
        <Button variant="secondary" size="sm" icon={Download} onClick={exportSector}>
          <span className="hidden sm:inline">Exportieren</span>
        </Button>
        <button
          onClick={onClose}
          aria-label="Schließen"
          className="rounded-lg p-1.5 text-muted transition-colors hover:bg-sunken hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <nav className="flex gap-0.5 overflow-x-auto px-4" aria-label="Sektor-Reiter">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'shrink-0 border-b-2 px-3 pb-2 pt-1 text-xs font-medium transition-colors',
              tab === t.id ? 'text-ink' : 'border-transparent text-muted hover:text-ink',
            )}
            style={tab === t.id ? { borderColor: sector.color } : undefined}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  )

  return (
    <Modal
      open
      onClose={onClose}
      // Sichtbar steht der Name in `header`; `title` benennt nur den Dialog
      // für Screenreader, gerendert wird er neben einer eigenen Kopfzeile nicht.
      title={`${sector.label} — Bereich der Wissensbasis`}
      header={header}
      className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden p-0"
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === 'overview' && (
          <div className="grid gap-3 lg:grid-cols-[1.55fr_1fr]">
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-edge bg-canvas/60 p-3.5 sm:grid-cols-4">
                <Stat
                  icon={Share2}
                  color={sector.color}
                  value={sector.count.toLocaleString('de-DE')}
                  label="Knoten"
                />
                <Stat
                  icon={Network}
                  color={sector.color}
                  value={sector.links.toLocaleString('de-DE')}
                  label="Verbindungen"
                />
                <Stat
                  icon={FileText}
                  color={sector.color}
                  value={String(docs.length)}
                  label="Dokumente"
                />
                <Stat
                  icon={Layers}
                  color={sector.color}
                  value={String(groups.groups.length)}
                  label="Hauptgruppen"
                />
              </div>

              <Section title="Beschreibung">
                <p className="text-xs leading-relaxed text-muted">{sector.blurb}</p>
              </Section>

              {groups.groups.length > 0 && (
                <Section title="Hauptgruppen">
                  <Donut
                    buckets={groups.groups}
                    rest={groups.rest}
                    total={sector.count}
                    label="Knoten"
                  />
                </Section>
              )}

              <Section title="Zeitleiste (erste Veröffentlichung)">
                <Bars buckets={years.years} color={sector.color} />
                {years.undated > 0 && (
                  <p className="mt-2 text-[10px] text-muted">
                    {years.undated.toLocaleString('de-DE')} Knoten ohne hinterlegtes Datum — bei
                    Begriffen die Regel, sie erscheinen in keinem Balken.
                  </p>
                )}
              </Section>

              <div className="grid gap-3 sm:grid-cols-2">
                <Section title="Top Quellen">
                  <Meter buckets={srcs} color={sector.color} rank />
                </Section>
                <Section title="Häufige Begriffe">
                  {words.length === 0 ? (
                    <p className="text-xs text-muted">Keine wiederkehrenden Begriffe.</p>
                  ) : (
                    <ul className="flex flex-wrap gap-1.5">
                      {words.map((w) => (
                        <li
                          key={w.label}
                          title={`${w.count.toLocaleString('de-DE')} Knoten`}
                          className="rounded-md border border-edge bg-sunken px-2 py-1 text-[11px] text-ink"
                        >
                          {w.label}
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <Section title="Beispiel-Knoten">
                <div className="-mx-2">
                  {sector.nodes.slice(0, 8).map((n) => (
                    <NodeRow key={n.id} node={n} color={sector.color} onPick={onPickNode} />
                  ))}
                </div>
                {sector.count > 8 && (
                  <button
                    onClick={() => setTab('nodes')}
                    className="mt-2 text-[11px] font-medium text-primary-400 hover:underline"
                  >
                    Alle {sector.count.toLocaleString('de-DE')} Knoten anzeigen →
                  </button>
                )}
              </Section>

              <Section title="Direkte Verbindungen">
                {neighbours.length === 0 ? (
                  <p className="text-xs text-muted">
                    Keine Kanten zu anderen Bereichen in dieser Auswahl.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {neighbours.map(({ sector: other, count }) => (
                      <li key={other.id} className="flex items-center gap-2 text-xs">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: other.color }}
                        />
                        <span
                          className="min-w-0 flex-1 truncate uppercase tracking-wider"
                          style={{ color: other.color }}
                        >
                          {other.label}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted">
                          {count.toLocaleString('de-DE')}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>
          </div>
        )}

        {tab === 'nodes' && (
          <div className="flex flex-col gap-3">
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setShown(PAGE)
              }}
              placeholder={`In ${sector.label} suchen …`}
              className="w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/50"
            />
            <p className="text-[11px] text-muted">
              {filtered.length.toLocaleString('de-DE')} Treffer · sortiert nach Vernetzung ·
              Spalten: Jahr · Vernetzung
            </p>
            <div className="-mx-2">
              {filtered.slice(0, shown).map((n) => (
                <NodeRow key={n.id} node={n} color={sector.color} onPick={onPickNode} />
              ))}
            </div>
            {filtered.length > shown && (
              <Button
                variant="secondary"
                size="sm"
                className="self-start"
                onClick={() => setShown((s) => s + PAGE)}
              >
                Weitere {Math.min(PAGE, filtered.length - shown)} anzeigen
              </Button>
            )}
          </div>
        )}

        {tab === 'links' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Section title="Verbindungstypen">
              <Meter
                buckets={relations.map((r) => ({
                  label: relationLabel(r.label),
                  count: r.count,
                }))}
                color={sector.color}
                limit={12}
              />
            </Section>
            <Section title="Nachbarbereiche">
              <Meter
                buckets={neighbours.map((n) => ({ label: n.sector.label, count: n.count }))}
                color={sector.color}
                limit={12}
              />
              <p className="mt-3 text-[11px] text-muted">
                {sector.internal.toLocaleString('de-DE')} Kanten verlaufen innerhalb des Bereichs.
              </p>
            </Section>
          </div>
        )}

        {tab === 'docs' && (
          <div>
            {docs.length === 0 ? (
              <p className="text-xs text-muted">
                Kein Knoten dieses Bereichs verweist auf ein Dokument im Bestand. Belege über
                <code className="mx-1 rounded bg-sunken px-1">source_document_ids</code>
                tragen nur Knoten aus der eigenen Extraktion.
              </p>
            ) : (
              <ul className="divide-y divide-edge">
                {docs.map((d) => (
                  <li key={d.id}>
                    <Link
                      to={`/wissen/doc/${d.id}`}
                      className="flex items-center gap-3 px-2 py-2 transition-colors hover:bg-sunken"
                    >
                      <FileText className="h-4 w-4 shrink-0 text-muted" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs text-ink">{d.title}</span>
                        <span className="block text-[10px] text-muted">
                          {d.source_type} · {d.lang} · {d.chunks} Chunks
                        </span>
                      </span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === 'clusters' && (
          <div className="flex flex-col gap-3">
            {groups.groups.length === 0 ? (
              <p className="text-xs leading-relaxed text-muted">
                {sector.synthetic
                  ? 'Die Systemebene steht außerhalb des Wissensgraphen und wird deshalb nicht geclustert.'
                  : 'In diesem Bereich ist jeder Knoten sein eigenes Thema: Konzepte und Aufgaben sind die Anker, an denen die Cluster-Zuordnung alles andere aufhängt (siehe Graph-Explorer). Die Gruppen dieses Bereichs stehen deshalb in den Bereichen, die daran hängen — allen voran Papers.'}
              </p>
            ) : (
              <>
                <p className="text-[11px] text-muted">
                  Dieselbe Cluster-Zuordnung wie im Graph-Explorer, über den ganzen Graphen
                  gerechnet und danach auf diesen Bereich eingeschränkt.
                </p>
                {groups.groups.map((g) => (
                  <Section key={g.id} title={`${g.label} · ${g.count.toLocaleString('de-DE')}`}>
                    <div className="-mx-2">
                      {g.members.slice(0, 6).map((n) => (
                        <NodeRow
                          key={n.id}
                          node={n}
                          color={g.color ?? sector.color}
                          onPick={onPickNode}
                        />
                      ))}
                    </div>
                    {g.count > 6 && (
                      <p className="mt-1.5 px-2 text-[10px] text-muted">
                        … und {(g.count - 6).toLocaleString('de-DE')} weitere.
                      </p>
                    )}
                  </Section>
                ))}
                {groups.rest > 0 && (
                  <p className="text-[11px] text-muted">
                    {groups.rest.toLocaleString('de-DE')} Knoten verteilen sich auf kleinere
                    Gruppen.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {tab === 'time' && (
          <div className="flex flex-col gap-3">
            <Section title="Erste Veröffentlichung je Jahr">
              <Bars buckets={years.years} color={sector.color} height={180} ticks={10} />
              <p className="mt-2 text-[11px] text-muted">
                Aus Datumsfeld, arXiv-Id oder Quell-URL abgeleitet — nicht aus{' '}
                <code className="rounded bg-sunken px-1">first_seen</code>, das nur den Eintritt in
                diesen Bestand festhält.
                {years.undated > 0 &&
                  ` ${years.undated.toLocaleString('de-DE')} Knoten ohne Datum.`}
              </p>
            </Section>
            <Section title="Zuletzt in den Bestand aufgenommen">
              <div className="-mx-2">
                {[...sector.nodes]
                  .sort((a, b) => b.first_seen.localeCompare(a.first_seen))
                  .slice(0, 10)
                  .map((n) => (
                    <div key={n.id} className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <NodeRow node={n} color={sector.color} onPick={onPickNode} />
                      </div>
                      <Badge className="shrink-0">
                        {new Date(n.first_seen).toLocaleDateString('de-DE')}
                      </Badge>
                    </div>
                  ))}
              </div>
            </Section>
          </div>
        )}
      </div>
    </Modal>
  )
}
