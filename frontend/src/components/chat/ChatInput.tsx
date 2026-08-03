import { useEffect, useRef } from 'react'
import { SendHorizonal } from 'lucide-react'
import { useAdminKey } from '../../app/AdminKeyContext'
import { cn } from '../../lib/cn'
import type { Zone } from '../../lib/storage'
import Select from '../ui/Select'
import SkillPicker from './SkillPicker'

const MAX_CHARS = 2000

interface ChatInputProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  busy: boolean
  zone: Zone
  onZoneChange: (zone: Zone) => void
  models?: string[] | null
  model: string | null
  onModelChange?: (model: string | null) => void
  placeholder: string
}

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
  placeholder,
}: ChatInputProps) {
  const { adminKey } = useAdminKey()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-grow bis ~6 Zeilen.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
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

  return (
    <div
      className="border-t border-edge bg-surface p-3"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto max-w-3xl">
        <div className="flex items-end gap-2">
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
            // text-base verhindert Auto-Zoom auf iOS.
            className={cn(
              'min-w-0 flex-1 resize-none rounded-xl border border-edge bg-canvas px-3 py-2.5',
              'text-base text-ink placeholder:text-muted sm:text-sm',
              'focus:border-primary-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30',
            )}
          />
          <button
            onClick={onSend}
            disabled={busy || !value.trim()}
            aria-label="Senden"
            className={cn(
              'shrink-0 rounded-xl bg-primary-600 p-2.5 text-white transition-colors',
              'hover:bg-primary-700 disabled:pointer-events-none disabled:opacity-40',
            )}
          >
            <SendHorizonal className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <SkillPicker onInsert={insertAtCursor} />
          {adminKey && (
            <label
              className="flex items-center gap-1.5 text-xs text-muted"
              title="Auch vertrauliche (lokale) Dokumente durchsuchen — Antwort kommt dann garantiert vom lokalen Modell"
            >
              <input
                type="checkbox"
                checked={zone === 'confidential'}
                onChange={(e) => onZoneChange(e.target.checked ? 'confidential' : 'public')}
              />
              confidential
            </label>
          )}
          {adminKey && models && models.length > 0 && onModelChange && (
            <label className="flex items-center gap-1.5 text-xs text-muted">
              Modell:
              <Select
                value={model ?? ''}
                onChange={(e) => onModelChange(e.target.value || null)}
                className="px-1.5 py-0.5 text-xs"
              >
                <option value="">Standard</option>
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </label>
          )}
          <span className="ml-auto text-[10px] tabular-nums text-muted">
            {value.length}/{MAX_CHARS}
          </span>
        </div>
      </div>
    </div>
  )
}
