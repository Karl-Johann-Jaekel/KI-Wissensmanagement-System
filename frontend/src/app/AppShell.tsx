import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { fetchReview } from '../api'
import { cn } from '../lib/cn'
import { useTheme } from '../lib/theme'
import { useAdminKey } from './AdminKeyContext'
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
  const { adminKey } = useAdminKey()
  // Theme-Hook hier mounten, damit die dark-Klasse ab dem ersten Render stimmt.
  useTheme()
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)

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

  // Inbox-Badge: pending-Fakten (nur Admin).
  useEffect(() => {
    if (!adminKey) {
      setPendingCount(0)
      return
    }
    let cancelled = false
    fetchReview(adminKey)
      .then((items) => !cancelled && setPendingCount(items.length))
      .catch(() => !cancelled && setPendingCount(0))
    return () => {
      cancelled = true
    }
  }, [adminKey, location.pathname])

  return (
    <div className="flex h-full">
      {/* Desktop-Sidebar */}
      <aside
        className={cn(
          'hidden shrink-0 transition-[width] duration-200 lg:block',
          collapsed ? 'w-16' : 'w-64',
        )}
      >
        <Sidebar
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          pendingCount={pendingCount}
        />
      </aside>

      {/* Mobile-Drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw]">
            <Sidebar
              collapsed={false}
              onToggleCollapsed={() => {}}
              onNavigate={() => setDrawerOpen(false)}
              pendingCount={pendingCount}
            />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile-Topbar */}
        <header className="flex items-center gap-3 border-b border-edge bg-surface px-4 py-2.5 lg:hidden">
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Menü öffnen"
            className="rounded-lg p-1.5 text-muted hover:bg-sunken hover:text-ink"
          >
            <Menu className="h-5 w-5" />
          </button>
          <img src="/icon.svg" alt="" className="h-6 w-6 shrink-0 rounded" />
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
