import { useEffect, useMemo, useState } from 'react'
import { fetchGraph } from './api'
import ChatPanel from './components/ChatPanel'
import DocumentsView from './components/DocumentsView'
import Filters from './components/Filters'
import GraphView from './components/GraphView'
import SidePanel from './components/SidePanel'
import { endpointId, type GraphData, type GraphNode, type Scope } from './types'
import { useElementSize } from './useElementSize'

const EMPTY: GraphData = { nodes: [], links: [] }
type Tab = 'graph' | 'chat' | 'portfolio' | 'docs'

const TABS: { id: Tab; label: string }[] = [
  { id: 'graph', label: 'Graph' },
  { id: 'chat', label: 'Wissens-Chat' },
  { id: 'portfolio', label: 'Portfolio-Chat' },
  { id: 'docs', label: 'Dokumente' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('graph')
  const [adminKey, setAdminKey] = useState<string | null>(
    () => localStorage.getItem('kwms-admin-key') || null,
  )
  const [showKeyInput, setShowKeyInput] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [portfolioPrefill, setPortfolioPrefill] = useState<string>()

  // ---- graph state (Phase 2 view) ----
  const [scope, setScope] = useState<Scope>('portfolio')
  const [data, setData] = useState<GraphData>(EMPTY)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
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

  const saveKey = () => {
    const key = keyDraft.trim()
    if (key) {
      localStorage.setItem('kwms-admin-key', key)
      setAdminKey(key)
    } else {
      localStorage.removeItem('kwms-admin-key')
      setAdminKey(null)
    }
    setShowKeyInput(false)
    setKeyDraft('')
  }

  const askAboutRepo = (repoName: string) => {
    setPortfolioPrefill(`Erzähl mir mehr über das Repo "${repoName}".`)
    setTab('portfolio')
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-slate-800 bg-slate-900/70 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-4">
          <h1 className="text-base font-semibold text-slate-100">KI-Wissensmanagement</h1>
          <nav className="flex overflow-hidden rounded-md border border-slate-700 text-sm">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={
                  'px-3 py-1.5 ' +
                  (tab === t.id
                    ? 'bg-sky-600 text-white'
                    : 'bg-slate-900 text-slate-300 hover:bg-slate-800')
                }
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2 text-xs">
            {showKeyInput ? (
              <>
                <input
                  type="password"
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveKey()}
                  placeholder="Admin API-Key (leer = abmelden)"
                  className="w-56 rounded border border-slate-700 bg-slate-950 px-2 py-1"
                  autoFocus
                />
                <button onClick={saveKey} className="rounded bg-sky-600 px-2 py-1">
                  OK
                </button>
              </>
            ) : (
              <button
                onClick={() => setShowKeyInput(true)}
                className={
                  'rounded border px-2 py-1 ' +
                  (adminKey
                    ? 'border-emerald-500/50 text-emerald-300'
                    : 'border-slate-700 text-slate-400 hover:text-slate-200')
                }
                title={adminKey ? 'Admin-Modus aktiv' : 'Recruiter-Modus (öffentlich)'}
              >
                {adminKey ? '🔓 Admin' : '🔒 Recruiter'}
              </button>
            )}
          </div>
        </div>
        {tab === 'graph' && (
          <div className="mt-2">
            <Filters
              scope={scope}
              onScope={setScope}
              data={data}
              filterTech={filterTech}
              onFilterTech={setFilterTech}
            />
          </div>
        )}
      </header>

      <main className="flex min-h-0 flex-1">
        {tab === 'graph' && (
          <>
            <div ref={ref} className="relative min-w-0 flex-1">
              {status === 'loading' && (
                <div className="absolute inset-0 grid place-items-center text-slate-400">
                  Lade {scope} …
                </div>
              )}
              {status === 'error' && (
                <div className="absolute inset-0 grid place-items-center p-6 text-center text-rose-300">
                  Konnte Graph nicht laden: {error}
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
                onAskAbout={askAboutRepo}
              />
            )}
          </>
        )}

        {tab === 'chat' && (
          <div className="min-w-0 flex-1">
            <ChatPanel
              endpoint="/chat"
              placeholder="Frage an den KI-Forschungskorpus … (DE/EN)"
              adminKey={adminKey}
              allowConfidential
              emptyHint='Frag den Korpus — z. B. „Was ist Retrieval-Augmented Generation?" Antworten kommen mit Quellenbelegen.'
            />
          </div>
        )}

        {tab === 'portfolio' && (
          <div className="min-w-0 flex-1">
            <ChatPanel
              endpoint="/portfolio/chat"
              placeholder="Frage zum GitHub-Portfolio …"
              adminKey={adminKey}
              prefill={portfolioPrefill}
              emptyHint='Frag zum Portfolio — z. B. „Welche Repos nutzen FastAPI?" Antworten verlinken die Repos.'
            />
          </div>
        )}

        {tab === 'docs' && (
          <div className="min-w-0 flex-1">
            <DocumentsView adminKey={adminKey} />
          </div>
        )}
      </main>
    </div>
  )
}
