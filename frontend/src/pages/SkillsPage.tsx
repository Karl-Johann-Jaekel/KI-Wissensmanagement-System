import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MessageSquarePlus, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import Input from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import Textarea from '../components/ui/Textarea'
import {
  deleteSkill,
  newId,
  saveSkill,
  seedSkillsOnce,
  useSkills,
  type Skill,
} from '../lib/storage'

export default function SkillsPage() {
  const navigate = useNavigate()
  const skills = useSkills()
  const [editing, setEditing] = useState<Skill | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Skill | null>(null)

  useEffect(seedSkillsOnce, [])

  const openEditor = (skill?: Skill) => {
    setEditing(skill ?? null)
    setName(skill?.name ?? '')
    setContent(skill?.content ?? '')
    setCreating(true)
  }

  const save = () => {
    if (!name.trim() || !content.trim()) return
    saveSkill({ id: editing?.id ?? newId(), name: name.trim(), content })
    setCreating(false)
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4 lg:p-6">
        <div className="flex items-center gap-3">
          <h1 className="flex-1 text-lg font-semibold">Skills</h1>
          <Button icon={Plus} size="sm" onClick={() => openEditor()}>
            Neuer Skill
          </Button>
        </div>
        <p className="text-xs text-muted">
          Skills sind wiederverwendbare Prompt-Vorlagen. Im Chat über das ✨-Symbol einfügbar —
          gespeichert nur in diesem Browser.
        </p>

        {skills.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="Noch keine Skills"
            hint={'Lege Vorlagen wie „Paper zusammenfassen" oder „Konzepte vergleichen" an.'}
            action={
              <Button size="sm" icon={Plus} onClick={() => openEditor()}>
                Skill anlegen
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {skills.map((skill) => (
              <Card key={skill.id} className="flex flex-col gap-2 p-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 shrink-0 text-primary-600 dark:text-primary-400" />
                  <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{skill.name}</h2>
                  <button
                    onClick={() => openEditor(skill)}
                    aria-label={`${skill.name} bearbeiten`}
                    className="rounded p-1 text-muted hover:bg-sunken hover:text-ink"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setDeleteTarget(skill)}
                    aria-label={`${skill.name} löschen`}
                    className="rounded p-1 text-muted hover:bg-sunken hover:text-rose-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="line-clamp-3 flex-1 text-xs text-muted">{skill.content}</p>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={MessageSquarePlus}
                  onClick={() => navigate('/chat', { state: { prefill: skill.content } })}
                  className="self-start"
                >
                  In Chat einfügen
                </Button>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title={editing ? 'Skill bearbeiten' : 'Neuer Skill'}
        className="max-w-lg"
      >
        <div className="flex flex-col gap-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={'Name, z. B. „Paper zusammenfassen"'}
            autoFocus
          />
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
            placeholder="Prompt-Text — wird im Chat an der Cursor-Position eingefügt."
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setCreating(false)}>
              Abbrechen
            </Button>
            <Button size="sm" onClick={save} disabled={!name.trim() || !content.trim()}>
              Speichern
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Skill löschen?"
      >
        <p className="text-sm text-muted">„{deleteTarget?.name}" wird entfernt.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setDeleteTarget(null)}>
            Abbrechen
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              if (deleteTarget) deleteSkill(deleteTarget.id)
              setDeleteTarget(null)
            }}
          >
            Löschen
          </Button>
        </div>
      </Modal>
    </div>
  )
}
