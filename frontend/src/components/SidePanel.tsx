import { ExternalLink, X } from 'lucide-react'
import type { GraphNode } from '../types'
import Badge from './ui/Badge'
import Button from './ui/Button'

interface Props {
  node: GraphNode
  onClose: () => void
}

/** Detailpanel zum ausgewählten Graph-Knoten: rechts als Spalte, mobil als Bottom-Sheet. */
export default function SidePanel({ node, onClose }: Props) {
  const meta = node.meta as {
    abstract?: string
    uri?: string
    arxiv?: string
    confidence?: number
    source_document_ids?: string[]
  }

  return (
    <aside
      className={
        'z-30 border-edge bg-surface p-4 ' +
        'fixed inset-x-0 bottom-0 max-h-[60%] overflow-y-auto rounded-t-2xl border-t shadow-2xl ' +
        'md:static md:max-h-none md:w-80 md:shrink-0 md:rounded-none md:border-l md:border-t-0 md:shadow-none'
      }
    >
      <div className="mb-3 flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted">{node.kind}</div>
          <h2 className="text-lg font-semibold text-ink">{node.name}</h2>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-muted hover:bg-sunken hover:text-ink"
          aria-label="Schließen"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {typeof node.citations === 'number' && (
        <div className="mb-3 flex items-baseline gap-2">
          <span
            className={
              'text-lg font-semibold tabular-nums ' +
              (node.landmark ? 'text-amber-600 dark:text-amber-400' : 'text-ink')
            }
          >
            {node.citations.toLocaleString('de-DE')}
          </span>
          <span className="text-xs text-muted">
            Zitationen{node.landmark ? ' · etablierte Primärquelle' : ''}
          </span>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <Badge tone={node.status === 'verified' ? 'green' : 'amber'}>{node.status}</Badge>
        <span className="text-muted">
          seit {new Date(node.first_seen).toLocaleDateString('de-DE')}
        </span>
      </div>

      {meta.abstract && <p className="mb-3 text-sm text-muted">{meta.abstract}</p>}

      {typeof meta.confidence === 'number' && (
        <div className="mb-3 text-xs text-muted">Konfidenz: {meta.confidence}</div>
      )}

      {(meta.uri ?? meta.arxiv) && (
        <a
          href={meta.uri ?? `https://arxiv.org/abs/${meta.arxiv}`}
          target="_blank"
          rel="noreferrer"
          className="mb-4 inline-block"
        >
          <Button size="sm" icon={ExternalLink}>
            Quelle öffnen
          </Button>
        </a>
      )}

      {meta.source_document_ids && meta.source_document_ids.length > 0 && (
        <div className="text-xs text-muted">
          Provenienz: {meta.source_document_ids.length} Quell-Dokument(e)
        </div>
      )}
    </aside>
  )
}
