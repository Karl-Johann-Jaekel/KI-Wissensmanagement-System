import { Globe, Lock } from 'lucide-react'
import { useAdminKey } from '../../app/AdminKeyContext'
import { cn } from '../../lib/cn'
import type { Zone } from '../../lib/storage'

interface ScopeChipProps {
  zone: Zone
  onChange: (zone: Zone) => void
}

/**
 * Zeigt die Datenzone der Anfrage und schaltet zwischen Neuralem Gedächtnis (public)
 * und Bibliothek (confidential) um. Umschalten nur mit Admin-Key — nicht-public
 * verlangt ihn serverseitig ohnehin.
 */
export default function ScopeChip({ zone, onChange }: ScopeChipProps) {
  const { adminKey } = useAdminKey()
  const confidential = zone === 'confidential'

  return (
    <button
      type="button"
      disabled={!adminKey}
      onClick={() => onChange(confidential ? 'public' : 'confidential')}
      title={
        adminKey
          ? 'Datenzone umschalten — confidential antwortet ausschließlich über das lokale Modell'
          : 'Nur das öffentliche Neurale Gedächtnis — Admin-Key nötig für die Bibliothek'
      }
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition-colors',
        'disabled:pointer-events-none disabled:opacity-60',
        confidential
          ? 'border-rose-500/40 bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
          : 'border-edge bg-sunken text-muted hover:text-ink',
      )}
    >
      {confidential ? <Lock className="h-3.5 w-3.5" /> : <Globe className="h-3.5 w-3.5" />}
      <span className="hidden sm:inline">
        {confidential ? 'Bibliothek' : 'Neurales Gedächtnis'}
      </span>
    </button>
  )
}
