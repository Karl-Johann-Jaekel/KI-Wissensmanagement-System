import { useEffect, useState } from 'react'
import { fetchGraph } from './api'
import ChatPanel from './components/ChatPanel'
import DocumentsView from './components/DocumentsView'
import GraphView from './components/GraphView'
import SidePanel from './components/SidePanel'
import { KIND_COLORS, type GraphData, type GraphNode, type NodeKind } from './types'
import { useElementSize } from './useElementSize'

const EMPTY: GraphData = { nodes: [], links: [] }
type Tab = 'graph' | 'chat' | 'docs'

const TABS: { id: Tab; label: string }[] = [
  { id: 'graph', label: 'Wissens-Graph' },
  { id: 'chat', label: 'Chat' },
  { id: 'docs', label: 'Dokumente' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('chat')
  const [adminKey, setAdminKey] = useState<string | null>(
    () => localStorage.getItem('kwms-admin-key') || null,
  )
  const [showKeyInput, setShowKeyInput] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')

  // ---- knowledge-graph state ----
  const [data, setData] = useState<GraphData>(EMPTY)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const [includePending, setIncludePending] = useState(false)
  const { ref, width, height } = useElementSize<HTMLDivElement>()

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setSelected(null)
    fetchGraph(includePending)
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
  }, [includePending])

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

  const kindsPresent = Array.from(new Set(data.nodes.map((n) => n.kind))) as NodeKind[]

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
          {tab === 'graph' && (
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span>
                {data.nodes.length} Knoten · {data.links.length} Kanten
              </span>
              {adminKey && (
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={includePending}
                    onChange={(e) => setIncludePending(e.target.checked)}
                  />
                  pending anzeigen
                </label>
              )}
              <span className="flex flex-wrap gap-2">
                {kindsPresent.map((k) => (
                  <span key={k} className="inline-flex items-center gap-1">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: KIND_COLORS[k] }}
                    />
                    {k}
                  </span>
                ))}
              </span>
            </div>
          )}
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
                title={adminKey ? 'Admin-Modus aktiv' : 'Öffentlicher Modus'}
              >
                {adminKey ? '🔓 Admin' : '🔒 Öffentlich'}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex min-h-0 flex-1">
        {tab === 'graph' && (
          <>
            <div ref={ref} className="relative min-w-0 flex-1">
              {status === 'loading' && (
                <div className="absolute inset-0 grid place-items-center text-slate-400">
                  Lade Wissens-Graph …
                </div>
              )}
              {status === 'error' && (
                <div className="absolute inset-0 grid place-items-center p-6 text-center text-rose-300">
                  Konnte Graph nicht laden: {error}
                </div>
              )}
              {status === 'ready' && data.nodes.length === 0 && (
                <div className="absolute inset-0 grid place-items-center p-6 text-center text-slate-400">
                  Noch keine Graph-Fakten. Der Wissens-Graph füllt sich in Phase 8
                  (Extraktion aus den Papers).
                </div>
              )}
              {status === 'ready' && data.nodes.length > 0 && width > 0 && (
                <GraphView
                  data={data}
                  width={width}
                  height={height}
                  activeIds={null}
                  selectedId={selected?.id ?? null}
                  onNodeClick={(n) => setSelected(n)}
                />
              )}
            </div>
            {selected && <SidePanel node={selected} onClose={() => setSelected(null)} />}
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

        {tab === 'docs' && (
          <div className="min-w-0 flex-1">
            <DocumentsView adminKey={adminKey} />
          </div>
        )}
      </main>
    </div>
  )
}
