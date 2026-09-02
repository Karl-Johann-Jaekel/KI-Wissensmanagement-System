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

/**
 * Kleines Menü mit Tastatur-, Outside-Click- und Escape-Bedienung.
 *
 * ``role="menu"`` ist ein Versprechen: Screenreader kündigen ein Menü an, und
 * dessen Bedienung ist festgelegt — Pfeiltasten wandern, Escape schließt, der
 * Fokus springt hinein und beim Schließen zurück auf den Auslöser. Ohne das
 * bekommen Tastaturnutzer ein Menü angesagt, das sie nicht bedienen können.
 */
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
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const items = () =>
    Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])

  const close = (focusTrigger = true) => {
    setOpen(false)
    if (focusTrigger) triggerRef.current?.focus()
  }

  // Beim Öffnen in das Menü springen — sonst bliebe der Fokus auf dem Auslöser
  // und die Pfeiltasten liefen ins Leere.
  useEffect(() => {
    if (open) items()[0]?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close()
        return
      }
      // Tab führt aus dem Menü heraus: dann gehört es geschlossen, aber der
      // Fokus dorthin, wohin Tab ihn trägt — nicht zurück auf den Auslöser.
      if (e.key === 'Tab') {
        setOpen(false)
        return
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') {
        return
      }
      const list = items()
      if (list.length === 0) return
      e.preventDefault()
      const aktuell = list.indexOf(document.activeElement as HTMLElement)
      const naechster =
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? list.length - 1
            : e.key === 'ArrowDown'
              ? (aktuell + 1) % list.length
              : (aktuell - 1 + list.length) % list.length
      list[naechster]?.focus()
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
        ref={triggerRef}
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
          ref={panelRef}
          role="menu"
          aria-label={label}
          className={cn(
            'absolute z-30 min-w-[13rem] rounded-xl border border-edge bg-surface p-1 shadow-lg',
            direction === 'up' ? 'bottom-full mb-2' : 'top-full mt-2',
            align === 'right' ? 'right-0' : 'left-0',
            panelClassName,
          )}
        >
          {children(close)}
        </div>
      )}
    </div>
  )
}
