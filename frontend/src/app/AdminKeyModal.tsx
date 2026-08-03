import { useState } from 'react'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import { useAdminKey } from './AdminKeyContext'

interface AdminKeyModalProps {
  open: boolean
  onClose: () => void
}

export default function AdminKeyModal({ open, onClose }: AdminKeyModalProps) {
  const { adminKey, setAdminKey } = useAdminKey()
  const [draft, setDraft] = useState('')

  const save = () => {
    setAdminKey(draft.trim() || null)
    setDraft('')
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Admin-Modus">
      <p className="mb-3 text-xs text-muted">
        Mit API-Key: Upload, Review-Queue, Bibliothek (confidential) und pending-Fakten.
        Leer lassen und speichern meldet ab.
      </p>
      <Input
        type="password"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
        placeholder={adminKey ? 'Neuer Key (leer = abmelden)' : 'Admin API-Key'}
        autoFocus
      />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onClose}>
          Abbrechen
        </Button>
        <Button size="sm" onClick={save}>
          Speichern
        </Button>
      </div>
    </Modal>
  )
}
