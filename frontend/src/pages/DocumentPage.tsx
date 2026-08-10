import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowLeft, ExternalLink, Pencil, Trash2 } from 'lucide-react'
import {
  deleteDocument,
  fetchDocument,
  updateDocumentContent,
  type DocumentDetail,
} from '../api'
import { useAdminKey } from '../app/AdminKeyContext'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import Spinner from '../components/ui/Spinner'
import Textarea from '../components/ui/Textarea'
import { useToast } from '../components/ui/Toast'

export default function DocumentPage() {
  const { docId } = useParams()
  const navigate = useNavigate()
  const { adminKey } = useAdminKey()
  const toast = useToast()

  const [doc, setDoc] = useState<DocumentDetail | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const load = useCallback(() => {
    if (!docId) return
    fetchDocument(docId, adminKey)
      .then((d) => {
        setDoc(d)
        setDraft(d.content)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [docId, adminKey])

  useEffect(load, [load])

  const dirty = editing && doc !== null && draft !== doc.content

  const save = async () => {
    if (!doc || !adminKey || saving) return
    setSaving(true)
    try {
      const result = await updateDocumentContent(doc.id, draft, adminKey)
      toast('success', `Neu indexiert: ${result.chunks} Chunks`)
      setEditing(false)
      load()
    } catch (e) {
      toast('error', e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!doc || !adminKey) return
    try {
      await deleteDocument(doc.id, adminKey)
      toast('success', 'Dokument gelöscht')
      navigate('/wissen')
    } catch (e) {
      toast('error', e instanceof Error ? e.message : String(e))
    }
  }

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
            onClick={() => {
              if (dirty && !window.confirm('Ungespeicherte Änderungen verwerfen?')) return
              navigate('/wissen')
            }}
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
          <span className="ml-auto flex gap-2">
            {doc.editable && adminKey && !editing && (
              <Button variant="secondary" size="sm" icon={Pencil} onClick={() => setEditing(true)}>
                Bearbeiten
              </Button>
            )}
            {adminKey && (
              <Button variant="danger" size="sm" icon={Trash2} onClick={() => setConfirmDelete(true)}>
                Löschen
              </Button>
            )}
          </span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl p-4 lg:p-6">
          {editing ? (
            <div className="flex flex-col gap-3">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={24}
                className="min-h-[60vh] font-mono text-xs leading-relaxed"
                spellCheck={false}
              />
              <div className="flex items-center justify-end gap-2">
                {dirty && <span className="mr-auto text-xs text-amber-500">Ungespeichert</span>}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setEditing(false)
                    setDraft(doc.content)
                  }}
                >
                  Abbrechen
                </Button>
                <Button size="sm" onClick={save} loading={saving} disabled={!dirty}>
                  Speichern & neu indexieren
                </Button>
              </div>
            </div>
          ) : (
            <article className="prose-md">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.content}</ReactMarkdown>
            </article>
          )}
        </div>
      </div>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Dokument löschen?">
        <p className="text-sm text-muted">
          „{doc.title}" wird inklusive aller {doc.chunks} Chunks aus dem Index entfernt.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)}>
            Abbrechen
          </Button>
          <Button variant="danger" size="sm" onClick={remove}>
            Endgültig löschen
          </Button>
        </div>
      </Modal>
    </div>
  )
}
