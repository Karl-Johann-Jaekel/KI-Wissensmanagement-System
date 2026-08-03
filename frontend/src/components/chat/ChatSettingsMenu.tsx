import { SlidersHorizontal } from 'lucide-react'
import Popover from '../ui/Popover'
import Select from '../ui/Select'

interface ChatSettingsMenuProps {
  topK: number
  onTopKChange: (topK: number) => void
  rerank: boolean
  onRerankChange: (rerank: boolean) => void
}

/** Retrieval-Einstellungen des Chats (entsprechen top_k / rerank in ChatRequest). */
export default function ChatSettingsMenu({
  topK,
  onTopKChange,
  rerank,
  onRerankChange,
}: ChatSettingsMenuProps) {
  return (
    <Popover
      label="Chat-Einstellungen"
      align="right"
      trigger={<SlidersHorizontal className="h-4 w-4" />}
      panelClassName="w-64 p-3"
    >
      {() => (
        <div className="flex flex-col gap-3">
          <label className="flex items-center justify-between gap-3 text-xs text-ink">
            <span>
              Quellen je Antwort
              <span className="block text-[11px] text-muted">Kontext-Chunks aus dem Index</span>
            </span>
            <Select
              value={topK}
              onChange={(e) => onTopKChange(Number(e.target.value))}
              className="px-1.5 py-0.5 text-xs"
            >
              {[3, 5, 8, 10, 15].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </label>

          <label className="flex items-start justify-between gap-3 text-xs text-ink">
            <span>
              Reranker erzwingen
              <span className="block text-[11px] text-muted">
                Genauer, aber spürbar langsamer auf CPU
              </span>
            </span>
            <input
              type="checkbox"
              checked={rerank}
              onChange={(e) => onRerankChange(e.target.checked)}
              className="mt-0.5"
            />
          </label>
        </div>
      )}
    </Popover>
  )
}
