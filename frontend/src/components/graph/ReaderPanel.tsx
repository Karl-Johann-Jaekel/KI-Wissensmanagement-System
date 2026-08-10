/**
 * Leseansicht neben dem Graphen: Knotendetails plus der Volltext des Quell-
 * Dokuments — Lesen ohne die Ansicht zu verlassen (kein App-Wechsel).
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ExternalLink, FileText, X } from 'lucide-react'
import { fetchDocument, type DocumentDetail } from '../../api'
import { useAdminKey } from '../../app/AdminKeyContext'
import { useTheme } from '../../lib/theme'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import Spinner from '../ui/Spinner'
import { LANDMARK_COLOR } from '../../types'
import { TIER_LABELS, type SceneNode } from './scene'

interface Props {
  node: SceneNode
  /** Aufgelöste Mitglieder, wenn der Knoten ein kollabierter Hub ist. */
  members: SceneNode[]
  onSelectNode: (node: SceneNode) => void
  onClose: () => void
}

/** Lange Dokumente werden im Panel gekürzt — der Rest liegt eine Seite weiter. */
const PREVIEW_CHARS = 6000

export default function ReaderPanel({ node, members, onSelectNode, onClose }: Props) {
  const { adminKey } = useAdminKey()
  const { theme } = useTheme()
  const meta = node.meta as {
    abstract?: string
    uri?: string
    arxiv?: string
    note?: string
    confidence?: number
    projectId?: string
    source_document_ids?: string[]
  }
  const docId = meta.source_document_ids?.[0]
  const [doc, setDoc] = useState<DocumentDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setDoc(null)
    setError('')
    if (!docId) return
    let cancelled = false
    setLoading(true)
    fetchDocument(docId, adminKey)
      .then((d) => !cancelled && setDoc(d))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [docId, adminKey])

  const preview = doc ? doc.content.slice(0, PREVIEW_CHARS) : ''
  const truncated = doc ? doc.content.length > PREVIEW_CHARS : false

  return (
    <aside
      className={
        'z-30 flex flex-col border-edge bg-surface ' +
        'fixed inset-x-0 bottom-0 max-h-[70%] rounded-t-2xl border-t shadow-2xl ' +
        'md:static md:max-h-none md:w-96 md:shrink-0 md:rounded-none md:border-l md:border-t-0 md:shadow-none'
      }
    >
      <div className="flex items-start justify-between gap-2 border-b border-edge p-4">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-muted">
            {node.members ? `Cluster · ${node.members.length} Knoten` : node.kind} ·{' '}
            {TIER_LABELS[node.tier]}
          </div>
          <h2 className="truncate text-lg font-semibold text-ink" title={node.name}>
            {node.name}
          </h2>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-muted hover:bg-sunken hover:text-ink"
          aria-label="Schließen"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {typeof node.citations === 'number' && (
          <div className="mb-3 flex items-baseline gap-2">
            <span
              className="text-lg font-semibold tabular-nums"
              style={node.landmark ? { color: LANDMARK_COLOR[theme] } : undefined}
            >
              {node.citations.toLocaleString('de-DE')}
            </span>
            <span className="text-xs text-muted">
              Zitationen{node.landmark ? ' · etablierte Primärquelle' : ''}
            </span>
          </div>
        )}

        {!node.synthetic && !node.members && (
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
            <Badge tone={node.status === 'verified' ? 'green' : 'amber'}>{node.status}</Badge>
            <span className="text-muted">
              seit {new Date(node.first_seen).toLocaleDateString('de-DE')}
            </span>
          </div>
        )}

        {meta.note && <p className="mb-3 text-sm text-muted">{meta.note}</p>}
        {meta.abstract && <p className="mb-3 text-sm text-muted">{meta.abstract}</p>}
        {typeof meta.confidence === 'number' && (
          <div className="mb-3 text-xs text-muted">Konfidenz: {meta.confidence}</div>
        )}

        {members.length > 0 && (
          <div className="mb-4">
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
              Enthält
            </div>
            <ul className="flex flex-col gap-0.5">
              {members.slice(0, 40).map((m) => (
                <li key={m.id}>
                  <button
                    onClick={() => onSelectNode(m)}
                    className="w-full truncate rounded px-1 py-0.5 text-left text-sm text-muted hover:bg-sunken hover:text-ink"
                  >
                    {m.name}
                  </button>
                </li>
              ))}
            </ul>
            {members.length > 40 && (
              <div className="mt-1 text-xs text-muted">… und {members.length - 40} weitere</div>
            )}
          </div>
        )}

        {meta.projectId && (
          <Link to={`/projekte/${meta.projectId}`} className="mb-4 inline-block">
            <Button size="sm" variant="secondary">
              Projekt öffnen
            </Button>
          </Link>
        )}

        {(meta.uri ?? meta.arxiv) && (
          <a
            href={meta.uri ?? `https://arxiv.org/abs/${meta.arxiv}`}
            target="_blank"
            rel="noreferrer"
            className="mb-4 mr-2 inline-block"
          >
            <Button size="sm" icon={ExternalLink} variant="secondary">
              Quelle
            </Button>
          </a>
        )}
        {docId && (
          <Link to={`/wissen/doc/${docId}`} className="mb-4 inline-block">
            <Button size="sm" icon={FileText}>
              Im Wissen öffnen
            </Button>
          </Link>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Spinner className="h-4 w-4" /> Lade Dokument …
          </div>
        )}
        {error && <p className="text-sm text-rose-500">Dokument nicht ladbar: {error}</p>}
        {doc && (
          <div className="border-t border-edge pt-3">
            <div className="mb-2 text-xs text-muted">
              {doc.title} · {doc.chunks} Chunks
            </div>
            <div className="prose-md">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{preview}</ReactMarkdown>
            </div>
            {truncated && (
              <Link
                to={`/wissen/doc/${doc.id}`}
                className="mt-2 inline-block text-sm text-primary-600 underline underline-offset-2 dark:text-primary-400"
              >
                Weiterlesen …
              </Link>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
