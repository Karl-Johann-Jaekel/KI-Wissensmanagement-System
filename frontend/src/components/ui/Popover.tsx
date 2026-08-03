import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

interface PopoverProps {
  /** Inhalt des Trigger-Buttons (Icon und/oder Label). */
  trigger: ReactNode
  /** Menü-Inhalt; `close` schließt das Popover nach einer Auswahl. */
  children: (close: () => void) => ReactNode
  label: string
  align?: 'left' | 'right'
  /** Öffnungsrichtung — in der Chat-Leiste nach oben. */
  direction?: 'up' | 'down'
  className?: string
  panelClassName?: string
  disabled?: boolean
}

/** Kleines Menü mit Outside-Click- und Escape-Handling. */
export default function Popover({
  trigger,
  children,
  label,
  align = 'left',
  direction = 'up',
  className,
  panelClassName,
  disabled,
}: PopoverProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted transition-colors',
          'hover:bg-sunken hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40',
          'disabled:pointer-events-none disabled:opacity-40',
          open && 'bg-sunken text-ink',
          className,
        )}
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            'absolute z-30 min-w-[13rem] rounded-xl border border-edge bg-surface p-1 shadow-lg',
            direction === 'up' ? 'bottom-full mb-2' : 'top-full mt-2',
            align === 'right' ? 'right-0' : 'left-0',
            panelClassName,
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}
