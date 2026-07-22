import { useEffect, useMemo, useState } from 'react'
import { fetchGraph } from './api'
import Filters from './components/Filters'
import GraphView from './components/GraphView'
import SidePanel from './components/SidePanel'
import { endpointId, type GraphData, type GraphNode, type Scope } from './types'
import { useElementSize } from './useElementSize'

const EMPTY: GraphData = { nodes: [], links: [] }

export default function App() {
  const [scope, setScope] = useState<Scope>('portfolio')
  const [data, setData] = useState<GraphData>(EMPTY)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string>('')
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const [filterTech, setFilterTech] = useState<string | null>(null)

  const { ref, width, height } = useElementSize<HTMLDivElement>()

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setSelected(null)
    setFilterTech(null)
    fetchGraph(scope)
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
  }, [scope])

  // Filter -> set of bright node ids (tech node + repos that use it), or null for "all".
  const activeIds = useMemo<Set<string> | null>(() => {
    if (!filterTech) return null
    const tech = data.nodes.find((n) => n.kind === 'technology' && n.name === filterTech)
    if (!tech) return null
    const ids = new Set<string>([tech.id])
    for (const l of data.links) {
      const s = endpointId(l.source)
      const t = endpointId(l.target)
      if (s === tech.id) ids.add(t)
      if (t === tech.id) ids.add(s)
    }
    return ids
  }, [filterTech, data])

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-slate-800 bg-slate-900/70 px-4 py-3">
        <div className="mb-2 flex items-baseline gap-3">
          <h1 className="text-base font-semibold text-slate-100">KI-Wissensmanagement</h1>
          <span className="text-xs text-slate-400">
            {scope === 'portfolio' ? 'Portfolio-Graph' : 'Wissens-Graph'} ·{' '}
            {data.nodes.length} Knoten · {data.links.length} Kanten
          </span>
        </div>
        <Filters
          scope={scope}
          onScope={setScope}
          data={data}
          filterTech={filterTech}
          onFilterTech={setFilterTech}
        />
      </header>

      <main className="flex min-h-0 flex-1">
        <div ref={ref} className="relative min-w-0 flex-1">
          {status === 'loading' && (
            <div className="absolute inset-0 grid place-items-center text-slate-400">
              Lade {scope} …
            </div>
          )}
          {status === 'error' && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center text-rose-300">
              Konnte Graph nicht laden: {error}
              <br />
              Backend erreichbar unter <code>/graph</code>? (VITE_API_BASE)
            </div>
          )}
          {status === 'ready' && data.nodes.length === 0 && (
            <div className="absolute inset-0 grid place-items-center text-slate-400">
              Noch keine Knoten in dieser Ansicht.
            </div>
          )}
          {status === 'ready' && data.nodes.length > 0 && width > 0 && (
            <GraphView
              data={data}
              width={width}
              height={height}
              activeIds={activeIds}
              selectedId={selected?.id ?? null}
              onNodeClick={(n) => setSelected(n.kind === 'repo' ? n : null)}
            />
          )}
        </div>

        {selected && (
          <SidePanel
            node={selected}
            data={data}
            onClose={() => setSelected(null)}
            onSelectTech={(tech) => setFilterTech(tech)}
          />
        )}
      </main>
    </div>
  )
}
