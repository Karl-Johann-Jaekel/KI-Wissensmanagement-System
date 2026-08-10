import { useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  BookOpen,
  Brain,
  FolderKanban,
  Inbox,
  Lock,
  MessageSquare,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Sparkles,
  Sun,
  Unlock,
} from 'lucide-react'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import { cn } from '../lib/cn'
import { deleteChat, renameChat, useChatIndex, type ChatMeta } from '../lib/storage'
import { useTheme } from '../lib/theme'
import { useAdminKey } from './AdminKeyContext'
import AdminKeyModal from './AdminKeyModal'

const NAV_ITEMS = [
  { to: '/suche', label: 'Suche', icon: Search },
  { to: '/inbox', label: 'Inbox', icon: Inbox },
  { to: '/wissen', label: 'Wissen', icon: BookOpen },
  { to: '/skills', label: 'Skills', icon: Sparkles },
  { to: '/projekte', label: 'Projekte', icon: FolderKanban },
]

interface SidebarProps {
  collapsed: boolean
  onToggleCollapsed: () => void
  onNavigate?: () => void
  pendingCount?: number
}

export default function Sidebar({
  collapsed,
  onToggleCollapsed,
  onNavigate,
  pendingCount = 0,
}: SidebarProps) {
  const navigate = useNavigate()
  const location = useLocation()
  // Params der Kind-Route sind im Layout nicht verfügbar — aus dem Pfad ableiten.
  const chatId = location.pathname.startsWith('/chat/')
    ? location.pathname.slice('/chat/'.length)
    : undefined
  const chats = useChatIndex()
  const { adminKey } = useAdminKey()
  const { theme, toggleTheme } = useTheme()
  const [keyModalOpen, setKeyModalOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<ChatMeta | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<ChatMeta | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)

  const go = (to: string) => {
    navigate(to)
    onNavigate?.()
  }

  const confirmRename = () => {
    if (renameTarget) renameChat(renameTarget.id, renameDraft)
    setRenameTarget(null)
  }

  const confirmDelete = () => {
    if (!deleteTarget) return
    const wasActive = location.pathname === `/chat/${deleteTarget.id}`
    deleteChat(deleteTarget.id)
    setDeleteTarget(null)
    if (wasActive) go('/chat')
  }

  return (
    <div className="flex h-full flex-col border-r border-edge bg-surface">
      {/* Brand */}
      <div
        className={cn('flex items-center gap-2 px-4 pb-2 pt-4', collapsed && 'justify-center px-2')}
      >
        <NavLink
          to="/"
          onClick={onNavigate}
          title="Zur Startseite"
          className={cn('flex min-w-0 items-center gap-2', collapsed && 'justify-center')}
        >
          <span className="shrink-0 rounded-lg bg-primary-600 p-1.5 text-white">
            <Brain className="h-5 w-5" />
          </span>
          {!collapsed && (
            <span className="min-w-0 break-words text-[13px] font-semibold leading-tight">
              KI-Wissensmanagement-System
            </span>
          )}
        </NavLink>
        <button
          onClick={onToggleCollapsed}
          aria-label={collapsed ? 'Sidebar ausklappen' : 'Sidebar einklappen'}
          className="ml-auto hidden rounded-lg p-1.5 text-muted hover:bg-sunken hover:text-ink lg:block"
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      {/* Neuer Chat */}
      <div className={cn('px-3 py-2', collapsed && 'px-2')}>
        <Button
          onClick={() => go('/chat')}
          icon={Plus}
          className={cn('w-full', collapsed && 'px-0')}
          aria-label="Neuer Chat"
        >
          {!collapsed && 'Neuer Chat'}
        </Button>
      </div>

      {/* Navigation */}
      <nav className={cn('flex flex-col gap-0.5 px-3', collapsed && 'px-2')} aria-label="Hauptnavigation">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors',
                collapsed && 'justify-center px-0',
                isActive
                  ? 'bg-primary-50 font-medium text-primary-700 dark:bg-primary-950/60 dark:text-primary-300'
                  : 'text-muted hover:bg-sunken hover:text-ink',
              )
            }
            title={collapsed ? label : undefined}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {!collapsed && <span className="flex-1 truncate">{label}</span>}
            {!collapsed && label === 'Inbox' && pendingCount > 0 && (
              <span className="rounded-full bg-primary-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                {pendingCount}
              </span>
            )}
            {!collapsed && label === 'Bibliothek' && !adminKey && (
              <Lock className="h-3 w-3 shrink-0 opacity-60" />
            )}
          </NavLink>
        ))}
      </nav>

      {/* Aktuelle Chats */}
      {!collapsed && (
        <div className="mt-4 flex min-h-0 flex-1 flex-col px-3">
          <div className="flex items-center gap-1.5 px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
            <MessageSquare className="h-3 w-3" />
            Aktuelle Chats
          </div>
          {chats.length === 0 ? (
            <p className="px-2.5 text-xs text-muted">
              Noch keine Chats. Starte oben mit „Neuer Chat".
            </p>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto pb-2">
              {chats.slice(0, 15).map((chat) => {
                const active = chatId === chat.id
                return (
                  <li key={chat.id} className="group relative">
                    <button
                      onClick={() => go(`/chat/${chat.id}`)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm',
                        active
                          ? 'bg-sunken font-medium text-ink'
                          : 'text-muted hover:bg-sunken hover:text-ink',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{chat.title}</span>
                    </button>
                    <button
                      onClick={() => setMenuFor(menuFor === chat.id ? null : chat.id)}
                      aria-label={`Optionen für ${chat.title}`}
                      className={cn(
                        'absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted opacity-0 hover:bg-edge hover:text-ink focus:opacity-100 group-hover:opacity-100',
                        menuFor === chat.id && 'opacity-100',
                      )}
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                    {menuFor === chat.id && (
                      <div className="absolute right-0 top-8 z-20 w-36 rounded-lg border border-edge bg-surface py-1 text-sm shadow-lg">
                        <button
                          onClick={() => {
                            setRenameDraft(chat.title)
                            setRenameTarget(chat)
                            setMenuFor(null)
                          }}
                          className="block w-full px-3 py-1.5 text-left hover:bg-sunken"
                        >
                          Umbenennen
                        </button>
                        <button
                          onClick={() => {
                            setDeleteTarget(chat)
                            setMenuFor(null)
                          }}
                          className="block w-full px-3 py-1.5 text-left text-rose-500 hover:bg-sunken"
                        >
                          Löschen
                        </button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
      {collapsed && <div className="flex-1" />}

      {/* Footer */}
      <div
        className={cn(
          'flex items-center gap-1 border-t border-edge px-3 py-2.5',
          collapsed && 'flex-col px-2',
        )}
      >
        <button
          onClick={() => setKeyModalOpen(true)}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-xs',
            collapsed && 'flex-none',
            adminKey
              ? 'text-primary-700 hover:bg-sunken dark:text-primary-300'
              : 'text-muted hover:bg-sunken hover:text-ink',
          )}
          title={adminKey ? 'Admin-Modus aktiv' : 'Öffentlicher Modus'}
        >
          {adminKey ? <Unlock className="h-4 w-4 shrink-0" /> : <Lock className="h-4 w-4 shrink-0" />}
          {!collapsed && <span className="truncate">{adminKey ? 'Admin' : 'Öffentlich'}</span>}
        </button>
        <button
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Helles Theme' : 'Dunkles Theme'}
          className="rounded-lg p-2 text-muted hover:bg-sunken hover:text-ink"
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>

      <AdminKeyModal open={keyModalOpen} onClose={() => setKeyModalOpen(false)} />

      <Modal open={renameTarget !== null} onClose={() => setRenameTarget(null)} title="Chat umbenennen">
        <Input
          value={renameDraft}
          onChange={(e) => setRenameDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && confirmRename()}
          autoFocus
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setRenameTarget(null)}>
            Abbrechen
          </Button>
          <Button size="sm" onClick={confirmRename}>
            Speichern
          </Button>
        </div>
      </Modal>

      <Modal open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} title="Chat löschen?">
        <p className="text-sm text-muted">
          „{deleteTarget?.title}" wird endgültig aus diesem Browser entfernt.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setDeleteTarget(null)}>
            Abbrechen
          </Button>
          <Button variant="danger" size="sm" onClick={confirmDelete}>
            Löschen
          </Button>
        </div>
      </Modal>
    </div>
  )
}
