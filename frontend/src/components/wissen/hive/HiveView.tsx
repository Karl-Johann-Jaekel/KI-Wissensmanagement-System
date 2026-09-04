/**
 * Die Wabenansicht — Einstieg in die Wissensbasis.
 *
 * Der Graph-Explorer beantwortet „was hängt woran"; er beantwortet nicht „was
 * liegt hier überhaupt". Diese Ansicht tut das: sieben Waben, je Bereich die
 * Größe, die bestvernetzten Knoten als Konstellation und ein Klick öffnet den
 * ganzen Bereich. Die Aggregation liegt in `hive.ts`, hier steht nur, wie sie
 * aussieht und worauf sie reagiert.
 *
 * Alle Zahlen kommen aus einer `/graph`-Antwort und sind damit serverseitig
 * gekappt (`DEFAULT_NODE_LIMIT`). Die Fußzeile sagt das, statt Vollständigkeit
 * zu suggerieren.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FileText, Hexagon, Link2, Network, Search, Share2, X } from 'lucide-react'
import { fetchGraph, type DocumentRow } from '../../../api'
import { GRAPH_SOURCES, type GraphData, type GraphSource } from '../../../types'
import { relationLabel } from '../../graph/relations'
import Select from '../../ui/Select'
import Spinner from '../../ui/Spinner'
import { Bars } from './Charts'
import HexTile from './HexTile'
import HiveSidebar, { type HiveMode } from './HiveSidebar'
import NodeRail from './NodeRail'
import SectorModal from './SectorModal'
import {
  applyFilter,
  buildHive,
  DEFAULT_FILTER,
  hexPath,
  hiveLayout,
  timeline,
  type HiveFilter,
  type HiveNode,
  type Sector,
} from './hive'

const EMPTY: GraphData = { nodes: [], links: [] }

/** Kantenlänge der Waben im Hintergrundmuster. */
const GRID = 26

interface Props {
  documents: DocumentRow[]
  /** Wechselt in den Reiter „Graph". */
  onOpenGraph: () => void
}

function StatCard({ icon: Icon, value, label }: {
  icon: typeof Hexagon
  value: string
  label: string
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-edge bg-surface px-3.5 py-2.5">
      <Icon className="h-4 w-4 shrink-0 text-primary-400" />
      <div className="min-w-0">
        <div className="text-base font-semibold leading-none tabular-nums text-ink">{value}</div>
        <div className="mt-1 text-[10px] uppercase tracking-wider text-muted">{label}</div>
      </div>
    </div>
  )
}

export default function HiveView({ documents, onOpenGraph }: Props) {
  const [data, setData] = useState<GraphData>(EMPTY)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [source, setSource] = useState<GraphSource>('all')
  const [filter, setFilter] = useState<HiveFilter>(DEFAULT_FILTER)
  const [mode, setMode] = useState<HiveMode>('comb')
  const [focus, setFocus] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLDivElement>(null)

  /**
   * Geöffneter Bereich und geöffneter Knoten stehen in der Adresse.
   *
   * Damit trägt der Zurück-Knopf des Browsers dieselbe Bewegung wie der Pfeil
   * im Popup, und ein Link auf einen Knoten führt wieder dorthin. Vorher lagen
   * beide im lokalen Zustand: ein Klick auf einen Namen im Popup schloss es,
   * und der Weg zurück in den Bereich war verloren.
   */
  const [params, setParams] = useSearchParams()
  const openSectorId = params.get('bereich')
  const selectedId = params.get('knoten')

  const go = useCallback(
    (patch: { bereich?: string | null; knoten?: string | null }, push = true) => {
      const next = new URLSearchParams(params)
      for (const [key, value] of Object.entries(patch)) {
        if (value) next.set(key, value)
        else next.delete(key)
      }
      // Öffnen legt einen History-Schritt an, Zurückgehen ersetzt ihn — sonst
      // wüchse beim Hin und Her ein Stapel gleicher Einträge.
      setParams(next, { replace: !push })
    },
    [params, setParams],
  )

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    fetchGraph(false, source)
      .then((d) => {
        if (cancelled) return
        setData(d)
        setStatus('ready')
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [source])

  const hive = useMemo(
    () => buildHive(applyFilter(data, filter), { documents: documents.length }),
    [data, filter, documents.length],
  )
  const layout = useMemo(() => hiveLayout(hive.sectors.length), [hive.sectors.length])
  const sectorById = useMemo(
    () => new Map(hive.sectors.map((s) => [s.id, s])),
    [hive.sectors],
  )

  // Nimmt ein Filter den Knoten aus dem Bestand, zeigt die Adresse ins Leere —
  // dann bleibt die Auswahl schlicht aus, ohne die Adresse anzufassen.
  const selected = selectedId ? (hive.nodesById.get(selectedId) ?? null) : null
  const openSector = openSectorId ? (sectorById.get(openSectorId) ?? null) : null

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    const out: HiveNode[] = []
    for (const node of hive.nodesById.values()) {
      if (node.name.toLowerCase().includes(q)) out.push(node)
      if (out.length > 60) break
    }
    return out.sort((a, b) => b.val - a.val).slice(0, 8)
  }, [query, hive])

  // Klick außerhalb schließt die Trefferliste.
  useEffect(() => {
    if (matches.length === 0) return
    const onDown = (e: MouseEvent) => {
      if (!searchRef.current?.contains(e.target as Node)) setQuery('')
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [matches.length])

  const patchFilter = (patch: Partial<HiveFilter>) => setFilter((f) => ({ ...f, ...patch }))
  /** Knoten öffnen — im Popup, wenn eines offen ist, sonst in der Spalte. */
  const pickNode = (node: HiveNode) => {
    go({ knoten: node.id })
    setQuery('')
  }
  const openSectorAt = (id: string) => go({ bereich: id, knoten: null })

  const focusLabel = focus ? sectorById.get(focus)?.label : null
  const combined = useMemo(
    () => timeline(hive.sectors.flatMap((s) => (s.synthetic ? [] : s.nodes))),
    [hive.sectors],
  )
  // Zeitleiste: Bereiche mit Jahren bekommen ein Diagramm, der Rest eine Zeile.
  const byDate = useMemo(
    () =>
      hive.sectors
        .filter((s) => !s.synthetic)
        .map((sector) => ({ sector, years: timeline(sector.nodes) })),
    [hive.sectors],
  )
  const dated = byDate.filter((e) => e.years.years.length > 0)
  const undatedSectors = byDate.filter((e) => e.years.years.length === 0).map((e) => e.sector)

  return (
    <div className="relative flex h-full min-h-0">
      <aside className="hidden w-56 shrink-0 lg:block">
        <HiveSidebar
          mode={mode}
          onMode={setMode}
          sectors={hive.sectors}
          focus={focus}
          onFocus={setFocus}
          onHover={setHovered}
          source={source}
          onSource={setSource}
          filter={filter}
          onFilter={patchFilter}
          onOpenGraph={onOpenGraph}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Kennzahlen + Suche */}
        <div className="flex flex-wrap items-center gap-2 border-b border-edge px-4 py-3">
          <StatCard
            icon={Hexagon}
            value={hive.stats.nodes.toLocaleString('de-DE')}
            label="Knoten"
          />
          <StatCard
            icon={Link2}
            value={hive.stats.links.toLocaleString('de-DE')}
            label="Kanten"
          />
          <StatCard
            icon={FileText}
            value={hive.stats.documents.toLocaleString('de-DE')}
            label="Dokumente"
          />
          <StatCard
            icon={Share2}
            value={String(hive.stats.relations)}
            label="Verbindungsarten"
          />
          <StatCard
            icon={Network}
            value={String(hive.stats.sectors)}
            label="Bereiche"
          />

          <div ref={searchRef} className="relative ml-auto w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Suche in der Wissensbasis …"
              aria-label="Suche in der Wissensbasis"
              className="w-full rounded-xl border border-edge bg-surface py-2 pl-8 pr-3 text-xs text-ink placeholder:text-muted focus:border-primary-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30"
            />
            {matches.length > 0 && (
              <ul className="absolute right-0 top-full z-30 mt-1 w-full overflow-hidden rounded-xl border border-edge bg-surface shadow-xl">
                {matches.map((node) => {
                  const sector = sectorById.get(node.sector)
                  return (
                    <li key={node.id}>
                      <button
                        onClick={() => pickNode(node)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-sunken"
                      >
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: sector?.color }}
                        />
                        <span className="min-w-0 flex-1 truncate text-xs text-ink">
                          {node.name}
                        </span>
                        <span className="shrink-0 text-[10px] uppercase text-muted">
                          {sector?.label}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Unter `lg` fehlt die Seitenspalte. Ansicht und Quelle sind die zwei
            Einstellungen, ohne die die Seite dort nur noch ein Bild wäre. */}
        <div className="flex items-center gap-2 border-b border-edge px-4 py-2 lg:hidden">
          <div className="flex overflow-hidden rounded-lg border border-edge">
            {(
              [
                { id: 'comb', label: 'Wabe' },
                { id: 'time', label: 'Zeitleiste' },
              ] as const
            ).map((v) => (
              <button
                key={v.id}
                onClick={() => setMode(v.id)}
                className={
                  mode === v.id
                    ? 'bg-primary-950/70 px-2.5 py-1 text-[11px] font-medium text-primary-300'
                    : 'px-2.5 py-1 text-[11px] text-muted hover:bg-sunken hover:text-ink'
                }
              >
                {v.label}
              </button>
            ))}
          </div>
          <button
            onClick={onOpenGraph}
            className="rounded-lg border border-edge px-2.5 py-1 text-[11px] text-muted hover:bg-sunken hover:text-ink"
          >
            Netzwerk ↗
          </button>
          <Select
            value={source}
            onChange={(e) => setSource(e.target.value as GraphSource)}
            aria-label="Quelle"
            className="ml-auto py-1 text-[11px]"
          >
            {GRAPH_SOURCES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden">
          {status === 'loading' && (
            <div className="absolute inset-0 grid place-items-center gap-2 text-sm text-muted">
              <Spinner className="h-6 w-6" />
            </div>
          )}
          {status === 'error' && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-rose-500">
              Konnte die Wissensbasis nicht laden: {error}
            </div>
          )}
          {status === 'ready' && hive.sectors.length === 0 && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted">
              Keine Knoten in dieser Auswahl. Filter zurücksetzen oder eine andere Quelle wählen.
            </div>
          )}

          {status === 'ready' && hive.sectors.length > 0 && mode === 'comb' && (
            <div className="h-full overflow-auto p-3">
              {/* Rolle `group`, nicht `img`: `img` nähme die Waben als Knöpfe
                  aus dem Baum, den Screenreader vorlesen. */}
              <svg
                viewBox={layout.viewBox}
                className="mx-auto h-full max-h-[calc(100vh-14rem)] w-full min-h-[420px]"
                role="group"
                aria-label="Wabenstruktur der Wissensbasis"
              >
                <defs>
                  <pattern
                    id="hive-grid"
                    width={3 * GRID}
                    height={Math.sqrt(3) * GRID}
                    patternUnits="userSpaceOnUse"
                  >
                    <path
                      d={[
                        hexPath(0, 0, GRID),
                        hexPath(3 * GRID, 0, GRID),
                        hexPath(0, Math.sqrt(3) * GRID, GRID),
                        hexPath(3 * GRID, Math.sqrt(3) * GRID, GRID),
                        hexPath(1.5 * GRID, (Math.sqrt(3) * GRID) / 2, GRID),
                        hexPath(1.5 * GRID, (-Math.sqrt(3) * GRID) / 2, GRID),
                      ].join(' ')}
                      fill="none"
                      stroke="rgb(var(--c-muted))"
                      strokeWidth={0.7}
                      opacity={0.1}
                    />
                  </pattern>
                  <filter id="hive-glow-core" x="-40%" y="-40%" width="180%" height="180%">
                    <feGaussianBlur stdDeviation={16} />
                  </filter>
                  <radialGradient id="hive-vignette">
                    <stop offset="0%" stopColor="rgb(var(--c-surface))" stopOpacity={0.55} />
                    <stop offset="100%" stopColor="rgb(var(--c-surface))" stopOpacity={0} />
                  </radialGradient>
                  {hive.sectors.map((sector) => (
                    <radialGradient key={sector.id} id={`hive-fill-${sector.id}`}>
                      <stop offset="0%" stopColor={sector.color} stopOpacity={0.24} />
                      <stop offset="70%" stopColor={sector.color} stopOpacity={0.08} />
                      <stop offset="100%" stopColor={sector.color} stopOpacity={0.03} />
                    </radialGradient>
                  ))}
                  {hive.sectors.map((sector) => (
                    <filter
                      key={sector.id}
                      id={`hive-glow-${sector.id}`}
                      x="-40%"
                      y="-40%"
                      width="180%"
                      height="180%"
                    >
                      <feGaussianBlur stdDeviation={14} />
                    </filter>
                  ))}
                </defs>

                <rect
                  x={-layout.extent}
                  y={-layout.extent}
                  width={layout.extent * 2}
                  height={layout.extent * 2}
                  fill="url(#hive-grid)"
                />
                <circle r={layout.extent * 0.8} fill="url(#hive-vignette)" />

                {/* Speichen vom Kern zu den Waben */}
                {hive.sectors.map((sector, i) => {
                  const place = layout.tiles[i]
                  const active = hovered === sector.id || focus === sector.id
                  const t = layout.center.r / Math.hypot(place.cx, place.cy)
                  return (
                    <line
                      key={sector.id}
                      x1={place.cx * t * 1.06}
                      y1={place.cy * t * 1.06}
                      x2={place.cx * 0.9}
                      y2={place.cy * 0.9}
                      stroke={sector.color}
                      strokeWidth={active ? 1.8 : 1}
                      strokeDasharray="5 7"
                      opacity={focus && !active ? 0.12 : active ? 0.85 : 0.35}
                      className="hive-spoke transition-all duration-300"
                    />
                  )
                })}

                {/* Kern */}
                <g>
                  <path
                    d={hexPath(0, 0, layout.center.r * 1.06)}
                    fill="#60a5fa"
                    opacity={0.1}
                    filter="url(#hive-glow-core)"
                  />
                  <path
                    d={hexPath(0, 0, layout.center.r)}
                    fill="rgb(var(--c-surface))"
                    stroke="#60a5fa"
                    strokeWidth={1.8}
                    strokeLinejoin="round"
                  />
                  <text
                    y={-24}
                    textAnchor="middle"
                    fill="rgb(var(--c-ink))"
                    className="text-[15px] font-semibold"
                  >
                    {selected ? truncate(selected.name, 26) : 'Wissensbasis'}
                  </text>
                  <text
                    y={-2}
                    textAnchor="middle"
                    fill="rgb(var(--c-muted))"
                    className="text-[12px] tabular-nums"
                  >
                    {hive.stats.nodes.toLocaleString('de-DE')} Knoten
                  </text>
                  <text
                    y={15}
                    textAnchor="middle"
                    fill="rgb(var(--c-muted))"
                    className="text-[12px] tabular-nums"
                  >
                    {hive.stats.links.toLocaleString('de-DE')} Kanten
                  </text>
                  <text
                    y={40}
                    textAnchor="middle"
                    fill="rgb(var(--c-muted))"
                    className="text-[10px] uppercase tracking-[0.16em]"
                  >
                    {focusLabel ?? 'KWMS-Kern'}
                  </text>
                </g>

                {hive.sectors.map((sector, i) => (
                  <HexTile
                    key={sector.id}
                    sector={sector}
                    place={layout.tiles[i]}
                    dimmed={focus !== null && focus !== sector.id}
                    hovered={hovered === sector.id}
                    selectedNodeId={selected?.id ?? null}
                    onOpen={(s: Sector) => openSectorAt(s.id)}
                    onHover={setHovered}
                    onPickNode={pickNode}
                  />
                ))}
              </svg>
            </div>
          )}

          {status === 'ready' && hive.sectors.length > 0 && mode === 'time' && (
            <div className="h-full overflow-y-auto p-4">
              <div className="mx-auto flex max-w-4xl flex-col gap-4">
                <section className="rounded-xl border border-edge bg-surface p-4">
                  <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                    Wissensbasis nach Erstveröffentlichung
                  </h3>
                  <Bars buckets={combined.years} color="#60a5fa" height={150} ticks={12} />
                  <p className="mt-2 text-[11px] text-muted">
                    Jahr aus Datumsfeld, arXiv-Id oder Quell-URL abgeleitet.
                    {combined.undated > 0 &&
                      ` ${combined.undated.toLocaleString('de-DE')} Knoten tragen kein Datum und fehlen hier.`}
                  </p>
                </section>
                {/* Trägt nur ein Bereich Jahre, ist sein Diagramm dasselbe wie
                    das obere — dann bleibt es weg. */}
                {dated.length > 1 &&
                  dated.map(({ sector, years }) => (
                  <section key={sector.id} className="rounded-xl border border-edge bg-surface p-4">
                    <div className="mb-3 flex items-baseline justify-between gap-3">
                      <button
                        onClick={() => openSectorAt(sector.id)}
                        className="text-[11px] font-semibold uppercase tracking-[0.14em] hover:underline"
                        style={{ color: sector.color }}
                      >
                        {sector.label}
                      </button>
                      <span className="text-[11px] tabular-nums text-muted">
                        {sector.count.toLocaleString('de-DE')} Knoten ·{' '}
                        {years.undated.toLocaleString('de-DE')} ohne Datum
                      </span>
                    </div>
                    <Bars buckets={years.years} color={sector.color} height={72} ticks={12} />
                  </section>
                  ))}

                {/* Ein leeres Diagramm je datumsloser Wabe wäre eine Wand aus
                    „kein Datum hinterlegt". Eine Zeile sagt dasselbe. */}
                {undatedSectors.length > 0 && (
                  <section className="rounded-xl border border-dashed border-edge p-4">
                    <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                      Ohne hinterlegtes Datum
                    </h3>
                    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                      {undatedSectors.map((sector) => (
                        <li key={sector.id}>
                          <button
                            onClick={() => openSectorAt(sector.id)}
                            className="uppercase tracking-wider hover:underline"
                            style={{ color: sector.color }}
                          >
                            {sector.label}
                          </button>{' '}
                          <span className="tabular-nums text-muted">
                            {sector.count.toLocaleString('de-DE')}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[11px] leading-relaxed text-muted">
                      Im Papers-with-Code-Bestand trägt nur die Arbeit selbst ein Datum. Begriffe,
                      Modelle, Datensätze und Repos erben keins — sie stehen deshalb in keinem
                      Balken, statt auf ein erfundenes Jahr gelegt zu werden.
                    </p>
                  </section>
                )}
              </div>
            </div>
          )}

          {/* Knoten-Details als Überlagerung. Ist ein Bereich offen, steht der
              Knoten dort drin — sonst lägen zwei Ansichten desselben übereinander. */}
          {selected && !openSector && (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-start justify-end p-3">
              <NodeRail
                node={selected}
                sector={sectorById.get(selected.sector)}
                hive={hive}
                onPickNode={pickNode}
                onClose={() => go({ knoten: null }, false)}
                className="pointer-events-auto max-h-full w-full shadow-2xl sm:w-80"
              />
            </div>
          )}
        </div>

        {/* Verbindungstypen im Bestand */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-edge px-4 py-2 text-[10px] text-muted">
          <span className="font-semibold uppercase tracking-[0.14em]">Verbindungstypen</span>
          {hive.relations.slice(0, 8).map((r) => (
            <span key={r.relation} className="flex items-center gap-1.5">
              <span className="h-px w-4 bg-muted" />
              {relationLabel(r.relation)}
              <span className="tabular-nums opacity-70">{r.count.toLocaleString('de-DE')}</span>
            </span>
          ))}
          <span className="ml-auto">Serverantwort auf 2.000 Knoten gekappt (Kontingent je Art)</span>
        </div>
      </div>

      {/* Filterleiste für schmale Fenster — die Seitenspalte ist dort aus. */}
      {focus && (
        <button
          onClick={() => setFocus(null)}
          className="absolute bottom-14 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-edge bg-surface px-3 py-1.5 text-[11px] text-ink shadow-lg lg:hidden"
        >
          Bereich: {focusLabel}
          <X className="h-3 w-3" />
        </button>
      )}

      {openSector && (
        <SectorModal
          sector={openSector}
          hive={hive}
          documents={documents}
          node={selected}
          onClose={() => go({ bereich: null, knoten: null }, false)}
          onPickNode={pickNode}
          onBack={() => go({ knoten: null }, false)}
          onOpenGraph={onOpenGraph}
        />
      )}
    </div>
  )
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}
