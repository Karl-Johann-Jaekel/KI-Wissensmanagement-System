import type { GraphNode } from '../types'

interface Props {
  node: GraphNode
  onClose: () => void
}

export default function SidePanel({ node, onClose }: Props) {
  const meta = node.meta as {
    abstract?: string
    uri?: string
    arxiv?: string
    confidence?: number
    source_document_ids?: string[]
  }

  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-l border-slate-800 bg-slate-900/80 p-4">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">{node.kind}</div>
          <h2 className="text-lg font-semibold text-slate-100">{node.name}</h2>
        </div>
        <button
          onClick={onClose}
          className="rounded px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          aria-label="Schließen"
        >
          ✕
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span
          className={
            'rounded-full border px-2 py-0.5 ' +
            (node.status === 'verified'
              ? 'border-emerald-500/40 bg-emerald-900/50 text-emerald-200'
              : 'border-amber-500/40 bg-amber-900/50 text-amber-200')
          }
        >
          {node.status}
        </span>
        <span className="text-slate-500">
          seit {new Date(node.first_seen).toLocaleDateString('de-DE')}
        </span>
      </div>

      {meta.abstract && <p className="mb-3 text-sm text-slate-300">{meta.abstract}</p>}

      {typeof meta.confidence === 'number' && (
        <div className="mb-3 text-xs text-slate-400">Konfidenz: {meta.confidence}</div>
      )}

      {(meta.uri ?? meta.arxiv) && (
        <a
          href={meta.uri ?? `https://arxiv.org/abs/${meta.arxiv}`}
          target="_blank"
          rel="noreferrer"
          className="mb-4 inline-block rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500"
        >
          Quelle öffnen ↗
        </a>
      )}

      {meta.source_document_ids && meta.source_document_ids.length > 0 && (
        <div className="text-xs text-slate-400">
          Provenienz: {meta.source_document_ids.length} Quell-Dokument(e)
        </div>
      )}
    </aside>
  )
}
