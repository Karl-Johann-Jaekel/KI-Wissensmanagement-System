import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUp, Library, Plus, Upload } from 'lucide-react'
import { cn } from '../../lib/cn'
import type { Zone } from '../../lib/storage'
import Popover from '../ui/Popover'
import Spinner from '../ui/Spinner'
import ChatSettingsMenu from './ChatSettingsMenu'
import ModelMenu from './ModelMenu'
import ScopeChip from './ScopeChip'
import SkillPicker from './SkillPicker'

const MAX_CHARS = 2000

interface ChatInputProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  busy: boolean
  zone: Zone
  onZoneChange: (zone: Zone) => void
  models: string[] | null
  model: string | null
  onModelChange: (model: string | null) => void
  topK: number
  onTopKChange: (topK: number) => void
  rerank: boolean
  onRerankChange: (rerank: boolean) => void
  placeholder: string
}

/**
 * Eingabeleiste: Textfeld und Werkzeugzeile in einer Karte. Links Kontext-Aktionen
 * (Wissen hinzufügen, Skills, Datenzone), rechts Einstellungen, Modell und Senden.
 */
export default function ChatInput({
  value,
  onChange,
  onSend,
  busy,
  zone,
  onZoneChange,
  models,
  model,
  onModelChange,
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
                      navigate('/wissen')
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-sunken"
                  >
                    <Upload className="h-4 w-4 shrink-0 text-muted" />
                    Dokument hochladen
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      close()
                      navigate('/bibliothek')
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-sunken"
                  >
                    <Library className="h-4 w-4 shrink-0 text-muted" />
                    Bibliothek öffnen
                  </button>
                </>
              )}
            </Popover>

            <SkillPicker onInsert={insertAtCursor} />
            <ScopeChip zone={zone} onChange={onZoneChange} />

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
              <ModelMenu models={models} model={model} onChange={onModelChange} />
              <button
                type="button"
                onClick={onSend}
                disabled={!canSend}
                aria-label="Senden"
                title="Senden (Enter) · Zeilenumbruch mit Shift+Enter"
                className={cn(
                  'ml-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                  'bg-primary-600 text-white transition-colors hover:bg-primary-700',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40',
                  'disabled:pointer-events-none disabled:opacity-40',
                )}
              >
                {busy ? <Spinner className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
