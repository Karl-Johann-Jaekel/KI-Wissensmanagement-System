import { useNavigate } from 'react-router-dom'
import { FileText } from 'lucide-react'
import type { DocumentRow } from '../../api'
import Badge from '../ui/Badge'
import EmptyState from '../ui/EmptyState'
import { cn } from '../../lib/cn'

interface DocumentTableProps {
  docs: DocumentRow[]
  emptyHint?: string
}

/** Desktop: Tabelle; unter md: Karten-Liste. Zeilen-Klick öffnet den Reader. */
export default function DocumentTable({ docs, emptyHint }: DocumentTableProps) {
  const navigate = useNavigate()

  if (docs.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="Keine Dokumente"
        hint={emptyHint ?? 'Lade PDFs oder Markdown-Dateien hoch, um den Bestand zu füllen.'}
      />
    )
  }

  const open = (id: string) => navigate(`/wissen/doc/${id}`)

  return (
    <>
      {/* Desktop */}
      <table className="hidden w-full text-left text-sm md:table">
        <thead>
          <tr className="border-b border-edge text-xs uppercase tracking-wide text-muted">
            <th className="py-2 pr-3">Titel</th>
            <th className="py-2 pr-3">Typ</th>
            <th className="py-2 pr-3">Sprache</th>
            <th className="py-2 pr-3">Chunks</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            <tr
              key={d.id}
              onClick={() => open(d.id)}
              // Mit der Maus war die Zeile anklickbar, mit der Tastatur nicht
              // erreichbar. Die mobile Variante darunter macht es richtig.
              tabIndex={0}
              role="link"
              aria-label={`Dokument öffnen: ${d.title}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  open(d.id)
                }
              }}
              className={cn(
                'cursor-pointer border-b border-edge/60 hover:bg-sunken',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500/40',
              )}
            >
              <td className="max-w-md truncate py-2.5 pr-3 font-medium text-ink">{d.title}</td>
              <td className="py-2.5 pr-3">
                <Badge tone={d.source_type === 'markdown' ? 'violet' : 'neutral'}>
                  {d.source_type}
                </Badge>
              </td>
              <td className="py-2.5 pr-3 text-muted">{d.lang}</td>
              <td className="py-2.5 pr-3 text-muted">{d.chunks}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile */}
      <ul className="flex flex-col gap-2 md:hidden">
        {docs.map((d) => (
          <li key={d.id}>
            <button
              onClick={() => open(d.id)}
              className="w-full rounded-xl border border-edge bg-surface px-3 py-2.5 text-left hover:bg-sunken"
            >
              <div className="truncate text-sm font-medium text-ink">{d.title}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                <Badge tone={d.source_type === 'markdown' ? 'violet' : 'neutral'}>
                  {d.source_type}
                </Badge>
                <span>{d.chunks} Chunks</span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}
