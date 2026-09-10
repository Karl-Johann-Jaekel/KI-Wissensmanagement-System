import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Brain, Menu } from 'lucide-react'
import { cn } from '../lib/cn'
import { useTheme } from '../lib/theme'
import Sidebar from './Sidebar'

const SIDEBAR_KEY = 'kwms.v1.sidebar'

function initialCollapsed(): boolean {
  try {
    return (JSON.parse(localStorage.getItem(SIDEBAR_KEY) ?? '{}') as { collapsed?: boolean })
      .collapsed === true
  } catch {
    return false
  }
}

export default function AppShell() {
  const location = useLocation()
  // Theme-Hook hier mounten, damit die dark-Klasse ab dem ersten Render stimmt.
  useTheme()
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const drawerRef = useRef<HTMLElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, JSON.stringify({ collapsed: !prev }))
      } catch {
        // Storage nicht verfügbar — Zustand gilt nur für die Session.
      }
      return !prev
    })
  }

  // Drawer schließt bei Navigation; Body-Scroll sperren solange offen.
  useEffect(() => setDrawerOpen(false), [location.pathname])
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [drawerOpen])

  /**
   * Der Drawer verhielt sich nicht wie ein Dialog: Escape schloss ihn nicht, der
   * Fokus blieb beim Öffnen auf `body` und wanderte beim Weitertabben hinter die
   * Verdunklung in die Seite darunter. `components/ui/Modal` macht das seit jeher
   * richtig — nur ist der Drawer daran vorbeigebaut, weil er von der Seite
   * einfliegt statt in der Mitte zu stehen. Hier dieselbe Mechanik, ohne die
   * Darstellung anzufassen.
   */
  useEffect(() => {
    if (!drawerOpen) return
    const panel = drawerRef.current
    const opener = menuButtonRef.current
    const focusable =
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
    panel?.querySelector<HTMLElement>(focusable)?.focus()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setDrawerOpen(false)
        return
      }
      if (e.key !== 'Tab' || !panel) return
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(focusable))
      if (nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      // Zurück auf den Knopf, der ihn geöffnet hat — sonst beginnt das nächste
      // Tab wieder ganz oben auf der Seite.
      opener?.focus()
    }
  }, [drawerOpen])

  return (
    <div className="flex h-full">
      {/* Desktop-Sidebar */}
      <aside
        aria-label="Seitenleiste"
        className={cn(
          'hidden shrink-0 transition-[width] duration-200 lg:block',
          collapsed ? 'w-16' : 'w-64',
        )}
      >
        <Sidebar
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
         
        />
      </aside>

      {/* Mobile-Drawer */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
          <aside ref={drawerRef} className="absolute inset-y-0 left-0 w-72 max-w-[85vw]">
            <Sidebar
              collapsed={false}
              onToggleCollapsed={() => {}}
              onNavigate={() => setDrawerOpen(false)}

            />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile-Topbar */}
        <header className="flex items-center gap-3 border-b border-edge bg-surface px-4 py-2.5 lg:hidden">
          <button
            ref={menuButtonRef}
            onClick={() => setDrawerOpen(true)}
            aria-label="Menü öffnen"
            aria-expanded={drawerOpen}
            // -m-1.5 haelt das Bild an seinem Platz, waehrend die Trefferflaeche waechst.
            className="-m-1.5 inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted hover:bg-sunken hover:text-ink"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="shrink-0 rounded-md bg-primary-600 p-1 text-white">
            <Brain className="h-4 w-4" />
          </span>
          <span className="min-w-0 truncate text-sm font-semibold">
            KI-Wissensmanagement-System
          </span>
        </header>

        <main className="min-h-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
