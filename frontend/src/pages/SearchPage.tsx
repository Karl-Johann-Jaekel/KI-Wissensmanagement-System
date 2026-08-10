import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronUp, MessageSquarePlus, Search as SearchIcon } from 'lucide-react'
import { postSearch, type SearchHitRow } from '../api'
import { useAdminKey } from '../app/AdminKeyContext'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import Input from '../components/ui/Input'
import Select from '../components/ui/Select'

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
        {hit.uri ? (
          <a
            href={hit.uri}
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

export default function SearchPage() {
  const { adminKey } = useAdminKey()
  const [query, setQuery] = useState('')
  const [topK, setTopK] = useState(5)
  const [rerank, setRerank] = useState(false)
  const [hits, setHits] = useState<SearchHitRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const search = async () => {
    const q = query.trim()
    if (!q || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await postSearch(
        q,
        { topK, rerank: rerank || null },
        adminKey,
      )
      setHits(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setHits(null)
    } finally {
      setBusy(false)
    }
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
            autoFocus
          />
          <Button onClick={search} loading={busy} icon={SearchIcon} aria-label="Suchen">
            <span className="hidden sm:inline">Suchen</span>
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
          <label className="flex items-center gap-1.5">
            Treffer:
            <Select
              value={topK}
              onChange={(e) => setTopK(Number(e.target.value))}
              className="px-1.5 py-0.5 text-xs"
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
            </Select>
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={rerank} onChange={(e) => setRerank(e.target.checked)} />
            Reranker
          </label>
        </div>

        {error && <p className="text-sm text-rose-500">{error}</p>}

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
