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
  // Ohne eigenen Ladezustand war die leere Liste nicht von „noch nichts geholt"
  // zu unterscheiden: bis die Antwort da war, stand auf der Einstiegsseite
  // „Keine neuen Fakten in 7 Tagen" — die Aussage kippte danach ins Gegenteil.
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    let aktuell = true
    setStatus('loading')
    fetchChangelog(days)
      .then((rows) => {
        if (!aktuell) return
        setItems(rows)
        setStatus('ready')
      })
      .catch((e: unknown) => {
        if (!aktuell) return
        setError(e instanceof Error ? e.message : String(e))
        setStatus('error')
      })
    return () => {
      aktuell = false
    }
  }, [days])

  if (status === 'loading')
    return (
      <p className="py-4 text-center text-sm text-muted" role="status">
        Lade Neuigkeiten …
      </p>
    )
  if (status === 'error') return <p className="text-sm text-rose-500">{error}</p>
  if (items.length === 0)
    return <p className="py-4 text-center text-sm text-muted">Keine neuen Fakten in {days} Tagen.</p>

  return (
    <ul className="flex flex-col divide-y divide-edge">
      {items.map((c) => (
        <li key={c.id}>
          {/* Der Feed war eine Sackgasse: Titel, aber kein Weg hinein. Der Klick
              führt in die Suche, weil sie als einzige Ansicht einen Knoten am
              Namen findet und von dort in Beleg und Chat weiterreicht. */}
          <Link
            to={`/suche?q=${encodeURIComponent(c.name)}`}
            title={c.name}
            className="-mx-2 flex min-h-11 items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-sunken pointer-fine:min-h-0"
          >
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: kindColors[c.kind as NodeKind] ?? FALLBACK_COLOR[theme] }}
            />
            <span className="min-w-0 flex-1 truncate text-ink">{c.name}</span>
            <span className="shrink-0 text-xs uppercase tracking-wide text-muted">{c.kind}</span>
            <span className="shrink-0 text-xs text-muted">
              {new Date(c.first_seen).toLocaleDateString('de-DE')}
            </span>
          </Link>
        </li>
      ))}
      <li className="flex justify-end pt-2">
        <Link
          to="/wissen?tab=graph"
          className="inline-flex min-h-11 items-center text-xs text-primary-600 hover:underline dark:text-primary-400 pointer-fine:min-h-0"
        >
          Im Graph ansehen →
        </Link>
      </li>
    </ul>
  )
}
