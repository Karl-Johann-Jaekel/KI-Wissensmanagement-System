import { Check, Zap } from 'lucide-react'
import { cn } from '../../lib/cn'
import Popover from '../ui/Popover'

interface ModelMenuProps {
  /** Installierte Ollama-Modelle; null = nicht verfügbar (kein Admin / Ollama offline). */
  models: string[] | null
  model: string | null
  onChange: (model: string | null) => void
}

/** Modellwahl in der Chat-Leiste — „Auto" folgt dem Zonen-Router (ADR-0008). */
export default function ModelMenu({ models, model, onChange }: ModelMenuProps) {
  const available = models !== null && models.length > 0

  return (
    <Popover
      label="Modell wählen"
      align="right"
      trigger={
        <>
          <Zap className="h-3.5 w-3.5" />
          <span className="hidden max-w-[9rem] truncate sm:inline">{model ?? 'Auto'}</span>
        </>
      }
    >
      {(close) => (
        <>
          <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
            Modell
          </p>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onChange(null)
              close()
            }}
            className="flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-sunken"
          >
            <Check className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', model && 'invisible')} />
            <span>
              <span className="block text-sm text-ink">Auto</span>
              <span className="block text-xs text-muted">
                Zonen-Router entscheidet (Mistral für public, Ollama für confidential)
              </span>
            </span>
          </button>
          {available ? (
            models.map((m) => (
              <button
                key={m}
                type="button"
                role="menuitem"
                onClick={() => {
                  onChange(m)
                  close()
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-sunken"
              >
                <Check className={cn('h-3.5 w-3.5 shrink-0', model !== m && 'invisible')} />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{m}</span>
              </button>
            ))
          ) : (
            <p className="px-2.5 py-1.5 text-xs text-muted">
              Keine lokalen Modelle wählbar — Admin-Key nötig und Ollama muss erreichbar sein.
            </p>
          )}
        </>
      )}
    </Popover>
  )
}
