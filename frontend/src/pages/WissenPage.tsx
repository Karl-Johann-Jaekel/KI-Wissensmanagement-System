import { lazy, Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { fetchDocuments, type DocumentRow } from '../api'
import GraphSection from '../components/GraphSection'
import DocumentTable from '../components/wissen/DocumentTable'
import { cn } from '../lib/cn'

// Die Wabenansicht ist der Einstieg und trotzdem faul geladen: sie zieht die
// Cluster-Rechnung und die Diagramme nach, die der Dokumentreiter nicht braucht.
const HiveView = lazy(() => import('../components/wissen/hive/HiveView'))

type WissenTab = 'wissensbasis' | 'dokumente' | 'graph'

const TAB_PARAM: Record<WissenTab, Record<string, string>> = {
  wissensbasis: {},
  graph: { tab: 'graph' },
  dokumente: { tab: 'dokumente' },
}

function readTab(raw: string | null): WissenTab {
  if (raw === 'dokumente') return 'dokumente'
  if (raw === 'graph') return 'graph'
  return 'wissensbasis'
}

export default function WissenPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  // Die Wabenansicht ordnet den Bestand ein, bevor der Graph ihn ausbreitet —
  // deshalb ist sie ohne Parameter der Standard (vorher: der Graph).
  const tab = readTab(searchParams.get('tab'))

  const [docs, setDocs] = useState<DocumentRow[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    fetchDocuments()
      .then(setDocs)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const setTab = (next: WissenTab) => setSearchParams(TAB_PARAM[next], { replace: true })

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-4 border-b border-edge bg-surface px-4 pt-3">
        <h1 className="hidden pb-3 text-base font-semibold lg:block">Wissen</h1>
        <nav className="flex gap-1 text-sm" aria-label="Wissen-Bereiche">
          {(
            [
              { id: 'wissensbasis', label: 'Wissensbasis' },
              { id: 'graph', label: 'Graph' },
              { id: 'dokumente', label: `Dokumente (${docs.length})` },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'border-b-2 px-3 pb-2.5 pt-1 font-medium transition-colors',
                tab === t.id
                  ? 'border-primary-600 text-primary-700 dark:text-primary-300'
                  : 'border-transparent text-muted hover:text-ink',
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="min-h-0 flex-1">
        {tab === 'wissensbasis' && (
          <Suspense
            fallback={<div className="p-6 text-sm text-muted">Lade Wissensbasis …</div>}
          >
            <HiveView documents={docs} onOpenGraph={() => setTab('graph')} />
          </Suspense>
        )}
        {tab === 'graph' && <GraphSection />}
        {tab === 'dokumente' && (
          <div className="h-full overflow-y-auto">
            <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4 lg:p-6">
              {error && <p className="text-sm text-rose-500">{error}</p>}
              <DocumentTable docs={docs} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
