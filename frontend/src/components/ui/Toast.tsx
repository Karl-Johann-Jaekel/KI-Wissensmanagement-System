import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { cn } from '../../lib/cn'

type ToastKind = 'info' | 'success' | 'error'

interface ToastItem {
  id: number
  kind: ToastKind
  text: string
}

const ToastContext = createContext<(kind: ToastKind, text: string) => void>(() => {})

/** `const toast = useToast(); toast('error', 'Speicher voll')` */
export function useToast() {
  return useContext(ToastContext)
}

const ICONS: Record<ToastKind, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  error: AlertCircle,
}

const STYLES: Record<ToastKind, string> = {
  info: 'border-edge',
  success: 'border-emerald-500/50',
  error: 'border-rose-500/50',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const push = useCallback(
    (kind: ToastKind, text: string) => {
      const id = nextId.current++
      setItems((prev) => [...prev.slice(-3), { id, kind, text }])
      window.setTimeout(() => dismiss(id), 5000)
    },
    [dismiss],
  )

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {items.map((t) => {
          const Icon = ICONS[t.kind]
          return (
            <div
              key={t.id}
              className={cn(
                'pointer-events-auto flex items-start gap-2 rounded-xl border bg-surface px-3 py-2.5 text-sm text-ink shadow-lg',
                STYLES[t.kind],
              )}
            >
              <Icon
                className={cn(
                  'mt-0.5 h-4 w-4 shrink-0',
                  t.kind === 'error' && 'text-rose-500',
                  t.kind === 'success' && 'text-emerald-500',
                  t.kind === 'info' && 'text-muted',
                )}
              />
              <span className="min-w-0 flex-1">{t.text}</span>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Meldung schließen"
                className="text-muted hover:text-ink"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
