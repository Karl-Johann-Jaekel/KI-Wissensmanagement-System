import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, X } from 'lucide-react'
import { fetchReview, reviewBulk, type PendingItem } from '../../api'
import { useToast } from '../ui/Toast'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import Select from '../ui/Select'

interface ReviewListProps {
  adminKey: string
  onChanged?: () => void
}

/**
 * Review-Queue mit Sammelfreigabe: filtern, mehrere Fakten auswählen und in einem
 * Aufruf verifizieren oder ablehnen. Provenienz wird serverseitig immer angehängt.
 */
export default function ReviewList({ adminKey, onChanged }: ReviewListProps) {
  const toast = useToast()
  const [items, setItems] = useState<PendingItem[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [minSources, setMinSources] = useState(0)
  const [minConfidence, setMinConfidence] = useState(0)

  const load = useCallback(() => {
    fetchReview(adminKey)
      .then((rows) => {
        setItems(rows)
        setSelected(new Set())
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [adminKey])

  useEffect(load, [load])

  const visible = useMemo(
    () =>
      items.filter((i) => i.sources >= minSources && i.confidence >= minConfidence),
    [items, minSources, minConfidence],
  )

  const visibleSelected = visible.filter((i) => selected.has(i.id))
  const allVisibleSelected = visible.length > 0 && visibleSelected.length === visible.length

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) visible.forEach((i) => next.delete(i.id))
      else visible.forEach((i) => next.add(i.id))
      return next
    })
  }

  const runBulk = async (action: 'verify' | 'reject', ids: string[]) => {
    if (ids.length === 0 || busy) return
    setBusy(true)
    try {
      const result = await reviewBulk(ids, action, adminKey)
      const done = new Set(ids)
      setItems((prev) => prev.filter((i) => !done.has(i.id)))
      setSelected(new Set())
      toast(
        'success',
        action === 'verify'
          ? `${result.processed} Fakten verifiziert (+${result.edges_verified} Kanten)`
          : `${result.processed} Fakten abgelehnt`,
      )
      onChanged?.()
    } catch (e) {
      toast('error', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const wellSupported = items.filter((i) => i.sources >= 2)

  return (
    <div>
      <p className="mb-3 text-xs text-muted">
        LLM-extrahierte Fakten starten als <em>pending</em>. Automatisch übernommen wird nur, was
        von mehreren unabhängigen Quellen gedeckt ist — der Rest wartet hier auf deine Freigabe.
      </p>
      {error && <p className="mb-3 text-sm text-rose-500">{error}</p>}

      {items.length === 0 && !error ? (
        <p className="py-6 text-center text-sm text-muted">Queue leer 🎉</p>
      ) : (
        <>
          {/* Werkzeugleiste */}
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-edge bg-sunken/60 px-3 py-2 text-xs">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleAllVisible}
                aria-label="Alle sichtbaren auswählen"
              />
              alle
            </label>
            <span className="text-muted">
              {visibleSelected.length > 0
                ? `${visibleSelected.length} ausgewählt`
                : `${visible.length} von ${items.length}`}
            </span>

            <label className="flex items-center gap-1.5 text-muted">
              Quellen ≥
              <Select
                value={minSources}
                onChange={(e) => setMinSources(Number(e.target.value))}
                className="px-1.5 py-0.5 text-xs"
              >
                {[0, 1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex items-center gap-1.5 text-muted">
              Konfidenz ≥
              <Select
                value={minConfidence}
                onChange={(e) => setMinConfidence(Number(e.target.value))}
                className="px-1.5 py-0.5 text-xs"
              >
                {[0, 0.5, 0.7, 0.9].map((n) => (
                  <option key={n} value={n}>
                    {n.toFixed(1)}
                  </option>
                ))}
              </Select>
            </label>

            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              {wellSupported.length > 0 && visibleSelected.length === 0 && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => runBulk('verify', wellSupported.map((i) => i.id))}
                  title="Alle Fakten mit mindestens zwei unabhängigen Quellen freigeben"
                >
                  {wellSupported.length} gut belegte freigeben
                </Button>
              )}
              <Button
                size="sm"
                icon={Check}
                loading={busy}
                disabled={visibleSelected.length === 0}
                onClick={() => runBulk('verify', visibleSelected.map((i) => i.id))}
              >
                Verifizieren
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon={X}
                disabled={busy || visibleSelected.length === 0}
                onClick={() => runBulk('reject', visibleSelected.map((i) => i.id))}
              >
                Ablehnen
              </Button>
            </div>
          </div>

          {visible.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">
              Kein Fakt erfüllt diesen Filter — Schwellen senken, um mehr zu sehen.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-edge">
              {visible.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2 py-2.5 sm:gap-3">
                  <input
                    type="checkbox"
                    checked={selected.has(i.id)}
                    onChange={() => toggle(i.id)}
                    aria-label={`${i.name} auswählen`}
                  />
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
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
