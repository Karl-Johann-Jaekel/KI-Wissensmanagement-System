import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronDown, ChevronUp, MessageSquarePlus, Search as SearchIcon } from 'lucide-react'
import { postSearch, type SearchHitRow } from '../api'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import Input from '../components/ui/Input'
import Select from '../components/ui/Select'
import { safeHref } from '../lib/safeHref'

function ScoreBars({ scores }: { scores: Record<string, number | null> }) {
  const entries = Object.entries(scores).filter(([, v]) => typeof v === 'number') as [
    string,
    number,
  ][]
  if (entries.length === 0) return null
  const max = Math.max(...entries.map(([, v]) => Math.abs(v)), 1e-9)
  return (
    <div className="mt-2 flex flex-col gap-1">
      {entries.map(([name, value]) => (
        <div key={name} className="flex items-center gap-2 text-[10px] text-muted">
          <span className="w-14 shrink-0 uppercase tracking-wide">{name}</span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
            <span
              className="block h-full rounded-full bg-primary-500"
              style={{ width: `${Math.min(100, (Math.abs(value) / max) * 100)}%` }}
            />
          </span>
          <span className="w-16 shrink-0 text-right tabular-nums">{value.toFixed(4)}</span>
        </div>
      ))}
    </div>
  )
}

function ResultCard({ hit }: { hit: SearchHitRow }) {
  const navigate = useNavigate()
  const [showScores, setShowScores] = useState(false)

  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-center gap-2">
        {safeHref(hit.uri) ? (
          <a
            href={safeHref(hit.uri)}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-primary-700 hover:underline dark:text-primary-300"
          >
            {hit.title}
          </a>
        ) : (
          <span className="font-medium text-ink">{hit.title}</span>
        )}
      </div>
      <p className="mt-1.5 line-clamp-3 text-sm text-muted">{hit.content}</p>
      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={() => setShowScores((s) => !s)}
          className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink"
        >
          {showScores ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          Scores
        </button>
        <button
          onClick={() => navigate('/chat', { state: { prefill: `Erkläre auf Basis von „${hit.title}": ` } })}
          className="inline-flex items-center gap-1 text-xs text-primary-600 hover:underline dark:text-primary-400"
        >
          <MessageSquarePlus className="h-3 w-3" />
          Im Chat weiterfragen
        </button>
      </div>
      {showScores && <ScoreBars scores={hit.scores} />}
    </Card>
  )
}

/** Serverseitige Obergrenze (`SearchRequest.query`). Darüber gab es HTTP 422. */
const MAX_QUERY = 2000

export default function SearchPage() {
  // Die Anfrage steht in der URL: eine Suche war bisher nicht teilbar und nach
  // einem Reload weg. Sie ist außerdem das Ziel, an das der „Neu"-Feed der
  // Einstiegsseite verweist.
  const [searchParams, setSearchParams] = useSearchParams()
  const urlQuery = searchParams.get('q') ?? ''
  const [query, setQuery] = useState(urlQuery)
  const [topK, setTopK] = useState(5)
  const [rerank, setRerank] = useState(false)
  const [hits, setHits] = useState<SearchHitRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const busyRef = useRef(false)

  const run = useCallback(
    async (raw: string, options: { topK: number; rerank: boolean }) => {
      const q = raw.trim().slice(0, MAX_QUERY)
      if (!q || busyRef.current) return
      busyRef.current = true
      setBusy(true)
      setError('')
      try {
        const result = await postSearch(q, { topK: options.topK, rerank: options.rerank || null })
        setHits(result)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        setHits(null)
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    [],
  )

  // Aufruf mit `?q=` — einmal je Anfrage, nicht bei jedem Tastendruck.
  useEffect(() => {
    if (!urlQuery) return
    setQuery(urlQuery)
    void run(urlQuery, { topK, rerank })
    // topK/rerank bewusst nicht als Dependency: ihre Änderung soll erst die
    // nächste ausgelöste Suche betreffen, nicht sofort eine neue starten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQuery, run])

  const search = () => {
    const q = query.trim()
    if (!q) return
    if (q === urlQuery) {
      void run(q, { topK, rerank })
      return
    }
    // Der URL-Wechsel stößt den Effekt oben an, der sucht.
    setSearchParams({ q }, { replace: true })
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 lg:p-6">
        <h1 className="text-lg font-semibold">Suche</h1>

        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder="Hybrid-Suche im Neuralen Gedächtnis … (DE/EN)"
            className="text-base sm:text-sm"
            maxLength={MAX_QUERY}
            aria-label="Suchbegriff"
            autoFocus
          />
          <Button onClick={search} loading={busy} icon={SearchIcon} aria-label="Suchen">
            <span className="hidden sm:inline">Suchen</span>
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
          <label className="flex min-h-11 items-center gap-1.5 pointer-fine:min-h-0">
            Treffer:
            <Select
              value={topK}
              onChange={(e) => setTopK(Number(e.target.value))}
              className="min-h-11 px-2 text-xs pointer-fine:min-h-0 pointer-fine:px-1.5 pointer-fine:py-0.5"
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
            </Select>
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 pointer-fine:min-h-0 pointer-fine:gap-1.5">
            <input
              type="checkbox"
              checked={rerank}
              onChange={(e) => setRerank(e.target.checked)}
              className="h-5 w-5 accent-primary-600 pointer-fine:h-4 pointer-fine:w-4"
            />
            Reranker
          </label>
        </div>

        {error && (
          <p className="text-sm text-rose-500" role="alert">
            {error}
          </p>
        )}

        {/* Die Suche läuft gemessen mehrere Sekunden; ohne Ansage passiert für
            einen Screenreader-Nutzer in dieser Zeit nichts und danach ebenso.
            Sichtbar, weil auch sehende Nutzer nicht abzählen sollten. */}
        <p aria-live="polite" className="text-xs text-muted">
          {busy ? 'Suche läuft …' : hits === null ? '' : `${hits.length} Treffer`}
        </p>

        {hits === null && !error && (
          <EmptyState
            icon={SearchIcon}
            title="Durchsuche den Wissensbestand"
            hint="Vektor- und Volltext-Suche laufen parallel und werden per Reciprocal Rank Fusion kombiniert. Scores pro Treffer einsehbar."
          />
        )}
        {hits !== null && hits.length === 0 && (
          <p className="py-6 text-center text-sm text-muted">Keine Treffer.</p>
        )}
        {hits !== null &&
          hits.map((hit) => <ResultCard key={hit.chunk_id} hit={hit} />)}
      </div>
    </div>
  )
}
