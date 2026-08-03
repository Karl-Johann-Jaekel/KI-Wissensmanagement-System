import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FolderKanban, Plus } from 'lucide-react'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import Input from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import Textarea from '../components/ui/Textarea'
import { newId, saveProject, useProjects } from '../lib/storage'

export default function ProjektePage() {
  const navigate = useNavigate()
  const projects = useProjects()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const create = () => {
    if (!name.trim()) return
    const id = newId()
    saveProject({
      id,
      name: name.trim(),
      description: description.trim(),
      chatIds: [],
      documentIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    setCreating(false)
    setName('')
    setDescription('')
    navigate(`/projekte/${id}`)
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4 lg:p-6">
        <div className="flex items-center gap-3">
          <h1 className="flex-1 text-lg font-semibold">Projekte</h1>
          <Button icon={Plus} size="sm" onClick={() => setCreating(true)}>
            Neues Projekt
          </Button>
        </div>
        <p className="text-xs text-muted">
          Projekte bündeln Chats und Dokumente zu einem Thema — gespeichert nur in diesem Browser.
        </p>

        {projects.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title="Noch keine Projekte"
            hint={'Lege einen Arbeitsbereich an, z. B. „RAG-Recherche" oder „Paper-Review".'}
            action={
              <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>
                Projekt anlegen
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {projects.map((p) => (
              <button key={p.id} onClick={() => navigate(`/projekte/${p.id}`)} className="text-left">
                <Card className="flex h-full flex-col gap-1.5 p-3 transition-colors hover:bg-sunken">
                  <div className="flex items-center gap-2">
                    <FolderKanban className="h-4 w-4 shrink-0 text-primary-600 dark:text-primary-400" />
                    <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{p.name}</h2>
                  </div>
                  {p.description && (
                    <p className="line-clamp-2 text-xs text-muted">{p.description}</p>
                  )}
                  <p className="mt-auto text-xs text-muted">
                    {p.chatIds.length} Chat{p.chatIds.length === 1 ? '' : 's'} ·{' '}
                    {p.documentIds.length} Dokument{p.documentIds.length === 1 ? '' : 'e'}
                  </p>
                </Card>
              </button>
            ))}
          </div>
        )}
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="Neues Projekt">
        <div className="flex flex-col gap-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            placeholder="Projektname"
            autoFocus
          />
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Beschreibung (optional)"
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setCreating(false)}>
              Abbrechen
            </Button>
            <Button size="sm" onClick={create} disabled={!name.trim()}>
              Anlegen
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
