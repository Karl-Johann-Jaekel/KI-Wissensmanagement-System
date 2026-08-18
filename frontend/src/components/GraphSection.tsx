/**
 * Graph-Explorer: Wissenswelten in vier Layouts, verschiebbares Menü, Minimap
 * und Leseansicht. Die Datenschicht (Zeitfilter, pending, Changelog) bleibt wie
 * gehabt; Darstellung und Interaktion liegen in `components/graph/`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchChangelog, fetchGraph, type ChangelogItem } from '../api'
import { useAdminKey } from '../app/AdminKeyContext'
import { useProjects } from '../lib/storage'
import { useTheme } from '../lib/theme'
import { endpointId, type GraphData, type GraphSource } from '../types'
import { useElementSize } from '../useElementSize'
import ControlPanel from './graph/ControlPanel'
import GraphCanvas from './graph/GraphCanvas'
import Minimap from './graph/Minimap'
import ReaderPanel from './graph/ReaderPanel'
import {
  applyDetail,
  buildScene,
  collapseGroups,
  EMPTY_SCENE,
  searchMatches,
  type SceneNode,
} from './graph/scene'
import { loadPrefs, savePrefs, type GraphPrefs, type GraphSettings } from './graph/settings'

const EMPTY: GraphData = { nodes: [], links: [] }

export default function GraphSection({ refreshKey = 0 }: { refreshKey?: number }) {
  const { adminKey } = useAdminKey()
  const { theme } = useTheme()
  const projects = useProjects()
  const [prefs] = useState(loadPrefs)
  const [settings, setSettings] = useState<GraphSettings>(prefs.settings)
  const [panelPos, setPanelPos] = useState(prefs.panel)

  const [data, setData] = useState<GraphData>(EMPTY)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<SceneNode | null>(null)
  const [includePending, setIncludePending] = useState(false)
  const [filterDays, setFilterDays] = useState<number | null>(null)
  const [source, setSource] = useState<GraphSource>('all')
  const [changelog, setChangelog] = useState<ChangelogItem[]>([])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [focus, setFocus] = useState<{ id: string; nonce: number } | null>(null)
  const [fg, setFg] = useState<unknown>(null)
  const { ref, width, height } = useElementSize<HTMLDivElement>()
  const nonce = useRef(0)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setSelected(null)
    fetchGraph(includePending, adminKey, source)
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
  }, [includePending, refreshKey, adminKey, source])

  const prefsRef = useRef(prefs)
  const persist = useCallback((patch: Partial<GraphPrefs>) => {
    prefsRef.current = { ...prefsRef.current, ...patch }
    savePrefs(prefsRef.current)
  }, [])

  const patchSettings = useCallback(
    (patch: Partial<GraphSettings>) => {
      const next = { ...settings, ...patch }
      setSettings(next)
      persist({ settings: next })
    },
    [settings, persist],
  )

  const movePanel = useCallback(
    (pos: { x: number; y: number }) => {
      setPanelPos(pos)
      persist({ panel: pos })
    },
    [persist],
  )

  // Zeitfilter: nur Knoten mit first_seen innerhalb N Tagen (+ deren Kanten).
  const filtered = useMemo<GraphData>(() => {
    if (!filterDays) return data
    const cutoff = Date.now() - filterDays * 86_400_000
    const nodes = data.nodes.filter((n) => new Date(n.first_seen).getTime() >= cutoff)
    const ids = new Set(nodes.map((n) => n.id))
    const links = data.links.filter(
      (l) => ids.has(endpointId(l.source)) && ids.has(endpointId(l.target)),
    )
    return { nodes, links }
  }, [data, filterDays])

  // Szene neu bauen: Cluster, Systemebenen, Detailtiefe, kollabierte Gruppen.
  const base = useMemo(
    () =>
      status === 'ready'
        ? buildScene(filtered, {
            theme,
            groupMode: settings.groupMode,
            showSystem: settings.showSystem,
            projects,
          })
        : EMPTY_SCENE,
    [filtered, status, theme, settings.groupMode, settings.showSystem, projects],
  )
  const scene = useMemo(
    () => collapseGroups(applyDetail(base, settings.detail), collapsed),
    [base, settings.detail, collapsed],
  )

  const matches = useMemo(() => searchMatches(scene, query), [scene, query])

  const jumpToFirstMatch = useCallback(() => {
    if (!matches || matches.size === 0) return
    const hit = scene.nodes.find((n) => matches.has(n.id))
    if (!hit) return
    nonce.current += 1
    setFocus({ id: hit.id, nonce: nonce.current })
    setSelected(hit)
  }, [matches, scene])

  const toggleGroup = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const onNodeClick = useCallback(
    (node: SceneNode) => {
      // Klick auf einen Hub klappt seinen Cluster wieder auf.
      if (node.members) {
        toggleGroup(node.group)
        setSelected(node)
        return
      }
      setSelected(node)
    },
    [toggleGroup],
  )

  const members = useMemo(() => {
    if (!selected?.members) return []
    const byId = new Map(base.nodes.map((n) => [n.id, n]))
    return selected.members.map((id) => byId.get(id)).filter((n): n is SceneNode => !!n)
  }, [selected, base])

  return (
    <div className="flex h-full min-h-0">
      <div ref={ref} className="relative min-h-0 min-w-0 flex-1">
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
        {status === 'ready' && scene.nodes.length === 0 && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-muted">
            {source === 'paperswithcode' ? (
              <span>
                Keine Fremdquellen-Knoten. Der Papers-with-Code-Dump wird über{' '}
                <code>python -m app.corpus.pwc</code> importiert.
              </span>
            ) : (
              <span>
                Keine Knoten in dieser Ansicht. Der Graph füllt sich über den
                Living-Knowledge-Loop (<code>python -m app.update</code>).
              </span>
            )}
          </div>
        )}
        {status === 'ready' && scene.nodes.length > 0 && width > 0 && (
          <GraphCanvas
            key={theme} // Remount beim Theme-Wechsel — vermeidet Canvas-Farbreste
            scene={scene}
            width={width}
            height={height}
            settings={settings}
            theme={theme}
            activeIds={matches}
            selectedId={selected?.id ?? null}
            focus={focus}
            onNodeClick={onNodeClick}
            onBackgroundClick={() => setSelected(null)}
            onInstance={setFg}
          />
        )}

        {status === 'ready' && (
          <ControlPanel
            nodeCount={scene.nodes.length}
            matchCount={matches ? matches.size : null}
            query={query}
            onQuery={setQuery}
            onSubmitQuery={jumpToFirstMatch}
            settings={settings}
            onChange={patchSettings}
            groups={scene.groups}
            collapsed={collapsed}
            onToggleGroup={toggleGroup}
            onExpandAll={() => setCollapsed(new Set())}
            onCollapseAll={() => setCollapsed(new Set(base.groups.map((g) => g.id)))}
            filterDays={filterDays}
            onFilterDays={setFilterDays}
            source={source}
            onSource={setSource}
            canSeePending={!!adminKey}
            includePending={includePending}
            onIncludePending={setIncludePending}
            changelog={changelog}
            position={panelPos}
            onPosition={movePanel}
          />
        )}

        {status === 'ready' && settings.minimap && scene.nodes.length > 0 && (
          <Minimap
            scene={scene}
            fg={fg}
            graphWidth={width}
            graphHeight={height}
            theme={theme}
          />
        )}

        <div className="pointer-events-none absolute bottom-3 right-3 z-10 rounded-lg bg-surface/80 px-2 py-1 text-[11px] text-muted backdrop-blur">
          {scene.nodes.length} Knoten · {scene.links.length} Kanten
        </div>
      </div>

      {selected && (
        <ReaderPanel
          node={selected}
          members={members}
          onSelectNode={(n) => setSelected(n)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
