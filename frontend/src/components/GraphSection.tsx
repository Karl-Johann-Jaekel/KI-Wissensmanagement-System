import { useEffect, useMemo, useState } from 'react'
import { fetchChangelog, fetchGraph, type ChangelogItem } from '../api'
import { useAdminKey } from '../app/AdminKeyContext'
import { useTheme } from '../lib/theme'
import {
  endpointId,
  KIND_COLORS,
  LANDMARK_COLOR,
  type GraphData,
  type GraphNode,
  type NodeKind,
} from '../types'
import { useElementSize } from '../useElementSize'
import GraphView from './GraphView'
import SidePanel from './SidePanel'
import Select from './ui/Select'

const EMPTY: GraphData = { nodes: [], links: [] }

/** Wissens-Graph mit Zeitfilter, pending-Toggle (Admin), Changelog-Overlay und Detailpanel. */
export default function GraphSection({ refreshKey = 0 }: { refreshKey?: number }) {
  const { adminKey } = useAdminKey()
  const { theme } = useTheme()
  const kindColors = KIND_COLORS[theme]
  const [data, setData] = useState<GraphData>(EMPTY)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const [includePending, setIncludePending] = useState(false)
  const [filterDays, setFilterDays] = useState<number | null>(null)
  const [changelog, setChangelog] = useState<ChangelogItem[]>([])
  const { ref, width, height } = useElementSize<HTMLDivElement>()

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setSelected(null)
    fetchGraph(includePending, adminKey)
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
    fetchChangelog(7)
      .then((c) => !cancelled && setChangelog(c))
      .catch(() => setChangelog([]))
    return () => {
      cancelled = true
    }
  }, [includePending, refreshKey, adminKey])

  // Zeitfilter: nur Knoten mit first_seen innerhalb N Tagen (+ deren Kanten).
  const view = useMemo<GraphData>(() => {
    if (!filterDays) return data
    const cutoff = Date.now() - filterDays * 86_400_000
    const nodes = data.nodes.filter((n) => new Date(n.first_seen).getTime() >= cutoff)
    const ids = new Set(nodes.map((n) => n.id))
    const links = data.links.filter(
      (l) => ids.has(endpointId(l.source)) && ids.has(endpointId(l.target)),
    )
    return { nodes, links }
  }, [data, filterDays])

  const kindsPresent = Array.from(new Set(view.nodes.map((n) => n.kind))) as NodeKind[]

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-edge px-4 py-2 text-xs text-muted">
          <span>
            {view.nodes.length} Knoten · {view.links.length} Kanten
          </span>
          <label className="flex items-center gap-1.5">
            Neu:
            <Select
              value={filterDays ?? ''}
              onChange={(e) => setFilterDays(e.target.value ? Number(e.target.value) : null)}
              className="px-1.5 py-0.5 text-xs"
            >
              <option value="">alle</option>
              <option value="7">7 Tage</option>
              <option value="30">30 Tage</option>
            </Select>
          </label>
          {adminKey && (
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={includePending}
                onChange={(e) => setIncludePending(e.target.checked)}
              />
              pending
            </label>
          )}
          <span className="hidden flex-wrap gap-2 sm:flex">
            {kindsPresent.map((k) => (
              <span key={k} className="inline-flex items-center gap-1">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: kindColors[k] }}
                />
                {k}
              </span>
            ))}
            {view.nodes.some((n) => n.landmark) && (
              <span
                className="inline-flex items-center gap-1"
                title="Vielzitierte Primärquelle (Semantic Scholar)"
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full border-2 bg-transparent"
                  style={{ borderColor: LANDMARK_COLOR[theme] }}
                />
                Primärquelle
              </span>
            )}
          </span>
        </div>

        <div ref={ref} className="relative min-h-0 flex-1">
          {status === 'loading' && (
            <div className="absolute inset-0 grid place-items-center text-muted">
              Lade Wissens-Graph …
            </div>
          )}
          {status === 'error' && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center text-rose-500">
              Konnte Graph nicht laden: {error}
            </div>
          )}
          {status === 'ready' && view.nodes.length === 0 && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center text-muted">
              Keine Knoten in dieser Ansicht. Der Graph füllt sich über den
              Living-Knowledge-Loop (<code>python -m app.update</code>).
            </div>
          )}
          {status === 'ready' && view.nodes.length > 0 && width > 0 && (
            <GraphView
              key={theme} // Remount beim Theme-Wechsel — vermeidet Canvas-Farbreste
              data={view}
              width={width}
              height={height}
              activeIds={null}
              selectedId={selected?.id ?? null}
              glowDays={filterDays ?? 7}
              onNodeClick={(n) => setSelected(n)}
              theme={theme}
            />
          )}
          {changelog.length > 0 && (
            <div className="absolute right-3 top-3 hidden max-h-[40%] w-64 overflow-y-auto rounded-lg border border-edge bg-surface/95 p-3 text-xs shadow-lg md:block">
              <div className="mb-1.5 font-semibold text-ink">✨ Neu (7 Tage)</div>
              <ul className="flex flex-col gap-1">
                {changelog.slice(0, 12).map((c) => (
                  <li key={c.id} className="flex items-center gap-1.5 text-muted">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: kindColors[c.kind as NodeKind] ?? '#94a3b8' }}
                    />
                    <span className="truncate">{c.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
      {selected && <SidePanel node={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
