import { useRef, useState, type DragEvent } from 'react'
import { UploadCloud } from 'lucide-react'
import { uploadDocument } from '../../api'
import { useAdminKey } from '../../app/AdminKeyContext'
import { cn } from '../../lib/cn'
import Select from '../ui/Select'
import Spinner from '../ui/Spinner'

interface UploadPanelProps {
  onUploaded: () => void
  /** Feste Zone (Bibliothek) oder wählbar (Wissen). */
  fixedSensitivity?: string
}

export default function UploadPanel({ onUploaded, fixedSensitivity }: UploadPanelProps) {
  const { adminKey } = useAdminKey()
  const [sensitivity, setSensitivity] = useState(fixedSensitivity ?? 'public')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  if (!adminKey) {
    return (
      <p className="rounded-xl border border-dashed border-edge px-4 py-3 text-xs text-muted">
        Upload nur im Admin-Modus — Key unten links in der Sidebar hinterlegen.
      </p>
    )
  }

  const handleFiles = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file || busy) return
    const name = file.name.toLowerCase()
    if (!name.endsWith('.pdf') && !name.endsWith('.md')) {
      setMessage('Nur .pdf oder .md erlaubt.')
      return
    }
    setBusy(true)
    setMessage(
      name.endsWith('.pdf')
        ? `„${file.name}" wird verarbeitet — Docling + Embeddings laufen, große PDFs blockieren kurz …`
        : `„${file.name}" wird indexiert …`,
    )
    try {
      const result = await uploadDocument(file, fixedSensitivity ?? sensitivity, adminKey)
      setMessage(
        result.status === 'added'
          ? `✓ ${result.filename}: ${result.chunks} Chunks indexiert`
          : `${result.filename}: ${result.status} (bereits vorhanden?)`,
      )
      onUploaded()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    void handleFiles(e.dataTransfer.files)
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition-colors',
          dragOver ? 'border-primary-500 bg-primary-50 dark:bg-primary-950/40' : 'border-edge',
        )}
      >
        {busy ? (
          <Spinner className="h-6 w-6 text-primary-600" />
        ) : (
          <UploadCloud className="h-6 w-6 text-primary-600 dark:text-primary-400" />
        )}
        <p className="text-sm text-ink">
          Datei hierher ziehen oder{' '}
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="font-medium text-primary-600 hover:underline dark:text-primary-400"
          >
            auswählen
          </button>
        </p>
        <p className="text-xs text-muted">PDF oder Markdown (.md), max. 2 MB für Markdown</p>
        {!fixedSensitivity && (
          <label className="mt-1 flex items-center gap-2 text-xs text-muted">
            Zone:
            <Select
              value={sensitivity}
              onChange={(e) => setSensitivity(e.target.value)}
              className="px-1.5 py-0.5 text-xs"
            >
              <option value="public">public</option>
              <option value="confidential">confidential</option>
            </Select>
          </label>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.md,application/pdf,text/markdown"
          className="hidden"
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </div>
      {message && <p className="mt-2 text-xs text-muted">{message}</p>}
    </div>
  )
}
