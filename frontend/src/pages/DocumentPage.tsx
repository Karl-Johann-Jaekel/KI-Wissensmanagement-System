import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { fetchDocument, type DocumentDetail } from '../api'
import Badge from '../components/ui/Badge'
import Spinner from '../components/ui/Spinner'

export default function DocumentPage() {
  const { docId } = useParams()
  const navigate = useNavigate()

  const [doc, setDoc] = useState<DocumentDetail | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    if (!docId) return
    fetchDocument(docId)
      .then(setDoc)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [docId])

  useEffect(load, [load])

  if (error) {
    return (
      <div className="grid h-full place-items-center p-6 text-center text-sm text-rose-500">
        Dokument konnte nicht geladen werden: {error}
      </div>
    )
  }
  if (!doc) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner className="h-6 w-6 text-primary-600" />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-edge bg-surface px-4 py-3">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-2">
          <button
            onClick={() => navigate('/wissen')}
            aria-label="Zurück zu Wissen"
            className="rounded-lg p-1.5 text-muted hover:bg-sunken hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{doc.title}</h1>
          {doc.uri && doc.uri.startsWith('http') && (
            <a
              href={doc.uri}
              target="_blank"
              rel="noreferrer"
              aria-label="Quelle öffnen"
              className="rounded-lg p-1.5 text-muted hover:bg-sunken hover:text-primary-600"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </div>
        <div className="mx-auto mt-1.5 flex max-w-4xl flex-wrap items-center gap-2 text-xs text-muted">
          <Badge tone={doc.source_type === 'markdown' ? 'violet' : 'neutral'}>
            {doc.source_type}
          </Badge>
          <span>{doc.chunks} Chunks</span>
          {doc.content_source === 'reassembled' && (
            <span title="Alt-Dokument ohne gespeichertes Markdown — Ansicht aus Chunks zusammengesetzt">
              rekonstruiert
            </span>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl p-4 lg:p-6">
          <article className="prose-md">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.content}</ReactMarkdown>
            </article>
        </div>
      </div>
    </div>
  )
}
