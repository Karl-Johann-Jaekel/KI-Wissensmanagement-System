import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Square } from 'lucide-react'
import { streamChat, type ChatSource } from '../../api'
import { cn } from '../../lib/cn'
import SourceCard from '../chat/SourceCard'
import type { SceneNode } from './scene'

/**
 * Kleiner Chat direkt am Datenpunkt.
 *
 * Nutzt denselben RAG-Weg wie die Chat-Seite, nur ohne Verlauf: eine Frage, eine
 * belegte Antwort. Der Knotenname wird der Frage vorangestellt, damit das
 * Retrieval beim Thema bleibt — der Nutzer sieht das Präfix, es passiert nichts
 * hinter seinem Rücken.
 */
const MAX_CHARS = 500

export default function NodeChat({ node }: { node: SceneNode }) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [sources, setSources] = useState<ChatSource[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // Knotenwechsel: laufende Antwort abbrechen und das Feld leeren, sonst stünde
  // die Antwort zum vorigen Datenpunkt unter dem neuen.
  useEffect(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setQuestion('')
    setAnswer('')
    setSources([])
    setError('')
    setBusy(false)
  }, [node.id])

  useEffect(() => () => abortRef.current?.abort(), [])

  const stop = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setBusy(false)
  }

  const ask = async () => {
    const q = question.trim()
    if (!q || busy) return
    setBusy(true)
    setAnswer('')
    setSources([])
    setError('')
    const controller = new AbortController()
    abortRef.current = controller

    await streamChat(
      '/chat',
      { query: `${node.name}: ${q}`, top_k: 5 },
      {
        onToken: (t) => setAnswer((a) => a + t),
        onSources: (s) => setSources(s),
        onDone: () => setBusy(false),
        onError: (e) => {
          setError(e)
          setBusy(false)
        },
      },
      controller.signal,
    )
    if (abortRef.current === controller) abortRef.current = null
  }

  return (
    <div className="mb-4 border-t border-edge pt-3">
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        Frage zu diesem Punkt
      </div>

      <div className="flex items-end gap-1.5">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value.slice(0, MAX_CHARS))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void ask()
            }
          }}
          rows={2}
          placeholder={`Was ist ${node.name}?`}
          aria-label={`Frage zu ${node.name}`}
          className={cn(
            'min-h-[2.5rem] flex-1 resize-none rounded-lg border border-edge bg-surface px-2.5 py-1.5',
            'text-sm text-ink placeholder:text-muted',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40',
          )}
        />
        <button
          type="button"
          onClick={busy ? stop : () => void ask()}
          disabled={!busy && !question.trim()}
          aria-label={busy ? 'Antwort abbrechen' : 'Frage senden'}
          title={busy ? 'Antwort abbrechen' : 'Senden (Enter)'}
          className={cn(
            'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white',
            'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40',
            'disabled:pointer-events-none disabled:opacity-40',
            busy ? 'bg-rose-600 hover:bg-rose-700' : 'bg-primary-600 hover:bg-primary-700',
          )}
        >
          {busy ? <Square className="h-3.5 w-3.5 fill-current" /> : <ArrowUp className="h-4 w-4" />}
        </button>
      </div>

      {(answer || busy) && (
        <div className="mt-2.5 rounded-lg bg-sunken px-3 py-2">
          <p aria-live="polite" className="whitespace-pre-wrap text-sm text-ink">
            {answer}
            {busy && !answer && <span className="text-muted">Antwort wird erzeugt …</span>}
          </p>
          {sources.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {sources.map((s, i) => (
                <SourceCard key={`${s.title ?? s.repo}-${i}`} source={s} />
              ))}
            </ul>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-sm text-rose-500">{error}</p>}
    </div>
  )
}
