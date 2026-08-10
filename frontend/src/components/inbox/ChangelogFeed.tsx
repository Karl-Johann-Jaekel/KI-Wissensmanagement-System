import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchChangelog, type ChangelogItem } from '../../api'
import { useTheme } from '../../lib/theme'
import { FALLBACK_COLOR, KIND_COLORS, type NodeKind } from '../../types'

/** „Neu (7 Tage)": zuletzt verifizierte Graph-Knoten — öffentlich sichtbar. */
export default function ChangelogFeed({ days = 7 }: { days?: number }) {
  const { theme } = useTheme()
  const kindColors = KIND_COLORS[theme]
  const [items, setItems] = useState<ChangelogItem[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    fetchChangelog(days)
      .then(setItems)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [days])

  if (error) return <p className="text-sm text-rose-500">{error}</p>
  if (items.length === 0)
    return <p className="py-4 text-center text-sm text-muted">Keine neuen Fakten in {days} Tagen.</p>

  return (
    <ul className="flex flex-col divide-y divide-edge">
      {items.map((c) => (
        <li key={c.id} className="flex items-center gap-2.5 py-2 text-sm">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: kindColors[c.kind as NodeKind] ?? FALLBACK_COLOR[theme] }}
          />
          <span className="min-w-0 flex-1 truncate text-ink">{c.name}</span>
          <span className="shrink-0 text-xs uppercase tracking-wide text-muted">{c.kind}</span>
          <span className="shrink-0 text-xs text-muted">
            {new Date(c.first_seen).toLocaleDateString('de-DE')}
          </span>
        </li>
      ))}
      <li className="pt-2 text-right">
        <Link
          to="/wissen?tab=graph"
          className="text-xs text-primary-600 hover:underline dark:text-primary-400"
        >
          Im Graph ansehen →
        </Link>
      </li>
    </ul>
  )
}
