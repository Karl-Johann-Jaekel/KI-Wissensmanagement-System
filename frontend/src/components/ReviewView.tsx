import { useCallback, useEffect, useState } from 'react'
import { fetchReview, reviewNode, type PendingItem } from '../api'

interface Props {
  adminKey: string
  onChanged: () => void
}

export default function ReviewView({ adminKey, onChanged }: Props) {
  const [items, setItems] = useState<PendingItem[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    fetchReview(adminKey)
      .then(setItems)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [adminKey])

  useEffect(load, [load])

  const act = async (id: string, action: 'verify' | 'reject') => {
    setBusy(id)
    try {
      await reviewNode(id, action, adminKey)
      setItems((prev) => prev.filter((i) => i.id !== id))
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto h-full max-w-4xl overflow-y-auto p-4">
      <div className="mb-2 flex items-baseline gap-3">
        <h2 className="text-lg font-semibold">Review-Queue</h2>
        <span className="text-sm text-slate-400">
          {items.length} ausstehende Fakten · nach Belege sortiert
        </span>
      </div>
      <p className="mb-4 text-xs text-slate-500">
        LLM-extrahierte Fakten starten als <em>pending</em>. Automatisch verifiziert wird nur
        bei ≥ 2 unabhängigen Quellen; alles andere landet hier zur Freigabe.
      </p>
      {error && <div className="mb-3 text-sm text-rose-300">{error}</div>}

      <ul className="flex flex-col divide-y divide-slate-800">
        {items.map((i) => (
          <li key={i.id} className="flex items-center gap-3 py-2">
            <span className="w-20 shrink-0 text-xs uppercase tracking-wide text-slate-400">
              {i.kind}
            </span>
            <span className="min-w-0 flex-1 truncate">{i.name}</span>
            <span
              className={
                'shrink-0 rounded px-1.5 py-0.5 text-xs ' +
                (i.sources >= 2 ? 'bg-emerald-900/50 text-emerald-200' : 'bg-slate-800 text-slate-400')
              }
              title="unabhängige Quell-Dokumente"
            >
              {i.sources} Quelle{i.sources === 1 ? '' : 'n'}
            </span>
            <span className="shrink-0 text-xs text-slate-500">conf {i.confidence}</span>
            <button
              onClick={() => act(i.id, 'verify')}
              disabled={busy === i.id}
              className="shrink-0 rounded bg-emerald-700 px-2 py-1 text-xs hover:bg-emerald-600 disabled:opacity-40"
            >
              ✓ verifizieren
            </button>
            <button
              onClick={() => act(i.id, 'reject')}
              disabled={busy === i.id}
              className="shrink-0 rounded bg-rose-800 px-2 py-1 text-xs hover:bg-rose-700 disabled:opacity-40"
            >
              ✕ ablehnen
            </button>
          </li>
        ))}
      </ul>
      {items.length === 0 && !error && (
        <div className="mt-10 text-center text-sm text-slate-500">Queue leer 🎉</div>
      )}
    </div>
  )
}
