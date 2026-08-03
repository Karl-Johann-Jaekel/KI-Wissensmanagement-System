import { useCallback, useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import { fetchReview, reviewNode, type PendingItem } from '../../api'
import Badge from '../ui/Badge'
import Button from '../ui/Button'

interface ReviewListProps {
  adminKey: string
  onChanged?: () => void
}

/** Review-Queue: pending Graph-Fakten per Klick verifizieren/ablehnen. */
export default function ReviewList({ adminKey, onChanged }: ReviewListProps) {
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
      onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <p className="mb-3 text-xs text-muted">
        LLM-extrahierte Fakten starten als <em>pending</em>. Automatisch verifiziert wird nur bei
        ≥ 2 unabhängigen Quellen; alles andere landet hier zur Freigabe.
      </p>
      {error && <p className="mb-3 text-sm text-rose-500">{error}</p>}

      {items.length === 0 && !error ? (
        <p className="py-6 text-center text-sm text-muted">Queue leer 🎉</p>
      ) : (
        <ul className="flex flex-col divide-y divide-edge">
          {items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-2 py-2.5 sm:gap-3">
              <span className="w-16 shrink-0 text-xs uppercase tracking-wide text-muted">
                {i.kind}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{i.name}</span>
              <Badge
                tone={i.sources >= 2 ? 'green' : 'neutral'}
                title="unabhängige Quell-Dokumente"
              >
                {i.sources} Quelle{i.sources === 1 ? '' : 'n'}
              </Badge>
              <span className="shrink-0 text-xs text-muted">conf {i.confidence}</span>
              <span className="flex shrink-0 gap-1.5">
                <Button
                  size="sm"
                  icon={Check}
                  onClick={() => act(i.id, 'verify')}
                  disabled={busy === i.id}
                  aria-label={`${i.name} verifizieren`}
                >
                  <span className="hidden sm:inline">verifizieren</span>
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  icon={X}
                  onClick={() => act(i.id, 'reject')}
                  disabled={busy === i.id}
                  aria-label={`${i.name} ablehnen`}
                >
                  <span className="hidden sm:inline">ablehnen</span>
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
