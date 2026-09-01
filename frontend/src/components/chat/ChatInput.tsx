import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUp, Network, Plus, Square } from 'lucide-react'
import { cn } from '../../lib/cn'
import Popover from '../ui/Popover'
import ChatSettingsMenu from './ChatSettingsMenu'
import SkillPicker from './SkillPicker'

const MAX_CHARS = 2000

interface ChatInputProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  busy: boolean
  /** Laufende Antwort abbrechen. Ohne das bliebe nur Wegnavigieren. */
  onStop: () => void
  topK: number
  onTopKChange: (topK: number) => void
  rerank: boolean
  onRerankChange: (rerank: boolean) => void
  placeholder: string
}

/**
 * Eingabeleiste: Textfeld und Werkzeugzeile in einer Karte. Links Kontext-Aktionen
 * (Wissen hinzufügen, Skills), rechts Einstellungen und Senden.
 */
export default function ChatInput({
  value,
  onChange,
  onSend,
  busy,
  onStop,
  topK,
  onTopKChange,
  rerank,
  onRerankChange,
  placeholder,
}: ChatInputProps) {
  const navigate = useNavigate()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-Grow bis ~7 Zeilen.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [value])

  const insertAtCursor = (text: string) => {
    const el = textareaRef.current
    if (!el) {
      onChange(value + text)
      return
    }
    const start = el.selectionStart ?? value.length
    const end = el.selectionEnd ?? value.length
    onChange(value.slice(0, start) + text + value.slice(end))
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + text.length
      el.setSelectionRange(pos, pos)
    })
  }

  const canSend = !busy && value.trim().length > 0

  return (
    <div
      className="border-t border-edge bg-canvas px-3 pt-3"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto max-w-3xl">
        <div
          className={cn(
            'rounded-2xl border border-edge bg-surface shadow-sm transition-colors',
            'focus-within:border-primary-500 focus-within:ring-2 focus-within:ring-primary-500/20',
          )}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value.slice(0, MAX_CHARS))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                onSend()
              }
            }}
            placeholder={placeholder}
            rows={1}
            aria-label="Nachricht"
            // text-base verhindert Auto-Zoom auf iOS.
            className={cn(
              'w-full resize-none bg-transparent px-4 pb-2 pt-3 text-base text-ink outline-none',
              'placeholder:text-muted sm:text-sm',
            )}
          />

          <div className="flex items-center gap-1 px-2 pb-2">
            <Popover
              label="Wissen hinzufügen"
              trigger={<Plus className="h-4 w-4" />}
              className="rounded-lg px-1.5"
            >
              {(close) => (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      close()
                      navigate('/wissen?tab=graph')
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-sunken"
                  >
                    <Network className="h-4 w-4 shrink-0 text-muted" />
                    Wissens-Graph öffnen
                  </button>
                </>
              )}
            </Popover>

            <SkillPicker onInsert={insertAtCursor} />

            <div className="ml-auto flex items-center gap-1">
              {value.length > MAX_CHARS * 0.75 && (
                <span className="mr-1 text-[10px] tabular-nums text-muted">
                  {value.length}/{MAX_CHARS}
                </span>
              )}
              <ChatSettingsMenu
                topK={topK}
                onTopKChange={onTopKChange}
                rerank={rerank}
                onRerankChange={onRerankChange}
              />
              {/* Waehrend einer laufenden Antwort wird aus Senden ein Abbrechen:
                  vorher drehte sich hier nur ein Spinner und eine aus dem Ruder
                  gelaufene Antwort liess sich gar nicht stoppen. */}
              <button
                type="button"
                onClick={busy ? onStop : onSend}
                disabled={!busy && !canSend}
                aria-label={busy ? 'Antwort abbrechen' : 'Senden'}
                title={busy ? 'Antwort abbrechen' : 'Senden (Enter) · Zeilenumbruch mit Shift+Enter'}
                className={cn(
                  'ml-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                  'text-white transition-colors',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40',
                  'disabled:pointer-events-none disabled:opacity-40',
                  busy ? 'bg-rose-600 hover:bg-rose-700' : 'bg-primary-600 hover:bg-primary-700',
                )}
              >
                {busy ? <Square className="h-3.5 w-3.5 fill-current" /> : <ArrowUp className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
