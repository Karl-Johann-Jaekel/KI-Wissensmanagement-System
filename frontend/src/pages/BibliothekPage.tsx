import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Library, Lock, MessageSquarePlus } from 'lucide-react'
import { fetchDocuments, fetchModels, type DocumentRow, type ModelsInfo } from '../api'
import { useAdminKey } from '../app/AdminKeyContext'
import DocumentTable from '../components/wissen/DocumentTable'
import UploadPanel from '../components/wissen/UploadPanel'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import Select from '../components/ui/Select'

/**
 * Bibliothek = privater Wissensspeicher (confidential-Zone).
 * Antworten kommen ausschließlich vom lokalen Ollama-Modell — nichts verlässt den Rechner.
 */
export default function BibliothekPage() {
  const { adminKey } = useAdminKey()
  const navigate = useNavigate()

  const [docs, setDocs] = useState<DocumentRow[]>([])
  const [error, setError] = useState('')
  const [models, setModels] = useState<ModelsInfo | null>(null)
  const [model, setModel] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!adminKey) return
    fetchDocuments(adminKey)
      .then((all) => setDocs(all.filter((d) => d.sensitivity !== 'public')))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
    fetchModels(adminKey)
      .then(setModels)
      .catch(() => setModels(null))
  }, [adminKey])

  useEffect(load, [load])

  if (!adminKey) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-4xl p-4 lg:p-6">
          <h1 className="mb-4 text-lg font-semibold">Bibliothek</h1>
          <EmptyState
            icon={Lock}
            title="Privater Bereich"
            hint="Die Bibliothek verwaltet vertrauliche Dokumente und antwortet nur über das lokale Ollama-Modell. Hinterlege den Admin-Key unten links in der Sidebar."
          />
        </div>
      </div>
    )
  }

  const startChat = () => {
    navigate('/chat', { state: { zone: 'confidential', model } })
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4 lg:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold">Bibliothek</h1>
          <span className="text-xs text-muted">
            privat · nur lokales Modell · verlässt nie diesen Rechner
          </span>
        </div>

        <Card className="flex flex-wrap items-center gap-3">
          <Library className="h-5 w-5 shrink-0 text-primary-600 dark:text-primary-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink">Mit der Bibliothek chatten</p>
            <p className="text-xs text-muted">
              {models === null
                ? 'Modelle werden geladen …'
                : models.available
                  ? `${models.models.length} lokale Modelle verfügbar (Standard: ${models.default})`
                  : 'Ollama nicht erreichbar — Standard-Konfiguration wird verwendet.'}
            </p>
          </div>
          {models?.available && models.models.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-muted">
              Modell:
              <Select
                value={model ?? ''}
                onChange={(e) => setModel(e.target.value || null)}
                className="text-xs"
              >
                <option value="">Standard ({models.default})</option>
                {models.models.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                    {m.parameter_size ? ` (${m.parameter_size})` : ''}
                  </option>
                ))}
              </Select>
            </label>
          )}
          <Button icon={MessageSquarePlus} onClick={startChat}>
            Chat starten
          </Button>
        </Card>

        <UploadPanel onUploaded={load} fixedSensitivity="confidential" />
        {error && <p className="text-sm text-rose-500">{error}</p>}
        <DocumentTable
          docs={docs}
          emptyHint="Noch keine privaten Dokumente. Lade PDFs oder Markdown-Notizen hoch — sie bleiben in der confidential-Zone."
        />
      </div>
    </div>
  )
}
