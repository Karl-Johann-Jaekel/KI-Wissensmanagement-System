import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  FileText,
  MessageSquare,
  MessageSquarePlus,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { fetchDocuments, type DocumentRow } from '../api'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import {
  deleteProject,
  getProject,
  saveProject,
  useChatIndex,
  useProjects,
  type Project,
} from '../lib/storage'

export default function ProjektDetailPage() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const projects = useProjects()
  const chats = useChatIndex()
  const project: Project | null = projects.find((p) => p.id === projectId) ?? null

  const [allDocs, setAllDocs] = useState<DocumentRow[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    fetchDocuments()
      .then(setAllDocs)
      .catch(() => setAllDocs([]))
  }, [])

  useEffect(() => {
    if (projectId && getProject(projectId) === null) navigate('/projekte', { replace: true })
  }, [projectId, navigate])

  if (!project) return null

  const projectChats = chats.filter((c) => c.projectId === project.id || project.chatIds.includes(c.id))
  const docById = new Map(allDocs.map((d) => [d.id, d]))

  const toggleDocument = (docId: string) => {
    const documentIds = project.documentIds.includes(docId)
      ? project.documentIds.filter((d) => d !== docId)
      : [...project.documentIds, docId]
    saveProject({ ...project, documentIds })
  }

  const remove = () => {
    deleteProject(project.id)
    navigate('/projekte')
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4 lg:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => navigate('/projekte')}
            aria-label="Zurück zu Projekten"
            className="rounded-lg p-1.5 text-muted hover:bg-sunken hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{project.name}</h1>
          <Button
            variant="danger"
            size="sm"
            icon={Trash2}
            onClick={() => setConfirmDelete(true)}
          >
            Löschen
          </Button>
        </div>
        {project.description && <p className="text-sm text-muted">{project.description}</p>}

        <Card>
          <div className="mb-2 flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary-600 dark:text-primary-400" />
            <h2 className="flex-1 text-sm font-semibold">Chats ({projectChats.length})</h2>
            <Button
              size="sm"
              variant="secondary"
              icon={MessageSquarePlus}
              onClick={() => navigate('/chat', { state: { projectId: project.id } })}
            >
              Chat hier starten
            </Button>
          </div>
          {projectChats.length === 0 ? (
            <p className="py-3 text-center text-xs text-muted">
              Noch keine Chats in diesem Projekt.
            </p>
          ) : (
            <ul className="divide-y divide-edge">
              {projectChats.map((c) => (
                <li key={c.id}>
                  <Link
                    to={`/chat/${c.id}`}
                    className="flex items-center gap-2 py-2 text-sm text-ink hover:text-primary-700 dark:hover:text-primary-300"
                  >
                    <span className="min-w-0 flex-1 truncate">{c.title}</span>
                    <span className="shrink-0 text-xs text-muted">
                      {new Date(c.updatedAt).toLocaleDateString('de-DE')}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="mb-2 flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary-600 dark:text-primary-400" />
            <h2 className="flex-1 text-sm font-semibold">Dokumente ({project.documentIds.length})</h2>
            <Button size="sm" variant="secondary" icon={Plus} onClick={() => setPickerOpen(true)}>
              Verknüpfen
            </Button>
          </div>
          {project.documentIds.length === 0 ? (
            <p className="py-3 text-center text-xs text-muted">Noch keine Dokumente verknüpft.</p>
          ) : (
            <ul className="divide-y divide-edge">
              {project.documentIds.map((docId) => {
                const doc = docById.get(docId)
                return (
                  <li key={docId} className="flex items-center gap-2 py-2 text-sm">
                    {doc ? (
                      <Link
                        to={`/wissen/doc/${docId}`}
                        className="min-w-0 flex-1 truncate text-ink hover:text-primary-700 dark:hover:text-primary-300"
                      >
                        {doc.title}
                      </Link>
                    ) : (
                      <span
                        className="min-w-0 flex-1 truncate text-muted line-through"
                        title="Dokument nicht mehr vorhanden oder nicht sichtbar"
                      >
                        {docId}
                      </span>
                    )}
                    <button
                      onClick={() => toggleDocument(docId)}
                      aria-label="Verknüpfung entfernen"
                      className="rounded p-1 text-muted hover:bg-sunken hover:text-rose-500"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>

      <Modal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Dokumente verknüpfen"
        className="max-w-lg"
      >
        {allDocs.length === 0 ? (
          <p className="text-sm text-muted">Keine Dokumente sichtbar.</p>
        ) : (
          <ul className="max-h-80 divide-y divide-edge overflow-y-auto">
            {allDocs.map((d) => (
              <li key={d.id}>
                <label className="flex cursor-pointer items-center gap-2.5 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={project.documentIds.includes(d.id)}
                    onChange={() => toggleDocument(d.id)}
                  />
                  <span className="min-w-0 flex-1 truncate">{d.title}</span>
                  <span className="shrink-0 text-xs text-muted">{d.source_type}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex justify-end">
          <Button size="sm" onClick={() => setPickerOpen(false)}>
            Fertig
          </Button>
        </div>
      </Modal>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Projekt löschen?">
        <p className="text-sm text-muted">
          „{project.name}" wird entfernt. Chats und Dokumente bleiben erhalten — nur die
          Zuordnung wird gelöst.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)}>
            Abbrechen
          </Button>
          <Button variant="danger" size="sm" onClick={remove}>
            Löschen
          </Button>
        </div>
      </Modal>
    </div>
  )
}
