import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchDocuments, uploadPdf, type DocumentRow } from '../api'
import SensitivityBadge from './SensitivityBadge'

interface Props {
  adminKey: string | null
}

export default function DocumentsView({ adminKey }: Props) {
  const [docs, setDocs] = useState<DocumentRow[]>([])
  const [error, setError] = useState('')
  const [uploadState, setUploadState] = useState<string>('')
  const [sensitivity, setSensitivity] = useState('confidential')
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    fetchDocuments(adminKey)
      .then(setDocs)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [adminKey])

  useEffect(load, [load])

  const onUpload = async () => {
    const file = fileRef.current?.files?.[0]
    if (!file || !adminKey) return
    setUploadState(`Lade "${file.name}" hoch — Docling + Embeddings laufen, dauert etwas …`)
    try {
      const result = await uploadPdf(file, sensitivity, adminKey)
      setUploadState(
        result.status === 'added'
          ? `✓ ${result.filename}: ${result.chunks} Chunks indexiert`
          : `${result.filename}: ${result.status} (bereits vorhanden?)`,
      )
      load()
    } catch (e) {
      setUploadState(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="mx-auto h-full max-w-4xl overflow-y-auto p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          Dokumente <span className="text-sm font-normal text-slate-400">({docs.length})</span>
        </h2>
        {adminKey ? (
          <div className="flex items-center gap-2 text-sm">
            <input ref={fileRef} type="file" accept="application/pdf" className="text-xs" />
            <select
              value={sensitivity}
              onChange={(e) => setSensitivity(e.target.value)}
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs"
            >
              <option value="confidential">confidential</option>
              <option value="public">public</option>
            </select>
            <button
              onClick={onUpload}
              className="rounded bg-sky-600 px-3 py-1.5 text-xs font-medium hover:bg-sky-500"
            >
              Upload + Ingest
            </button>
          </div>
        ) : (
          <span className="text-xs text-slate-500">Upload nur im Admin-Modus</span>
        )}
      </div>

      {uploadState && <div className="mb-3 text-xs text-slate-300">{uploadState}</div>}
      {error && <div className="mb-3 text-sm text-rose-300">{error}</div>}

      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-700 text-xs uppercase tracking-wide text-slate-400">
            <th className="py-2 pr-3">Titel</th>
            <th className="py-2 pr-3">Typ</th>
            <th className="py-2 pr-3">Sprache</th>
            <th className="py-2 pr-3">Chunks</th>
            <th className="py-2 pr-3">Zone</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id} className="border-b border-slate-800/60 hover:bg-slate-900/50">
              <td className="max-w-md truncate py-2 pr-3">
                {d.uri ? (
                  <a href={d.uri} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">
                    {d.title}
                  </a>
                ) : (
                  d.title
                )}
              </td>
              <td className="py-2 pr-3 text-slate-400">{d.source_type}</td>
              <td className="py-2 pr-3 text-slate-400">{d.lang}</td>
              <td className="py-2 pr-3 text-slate-400">{d.chunks}</td>
              <td className="py-2 pr-3">
                <SensitivityBadge value={d.sensitivity} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
