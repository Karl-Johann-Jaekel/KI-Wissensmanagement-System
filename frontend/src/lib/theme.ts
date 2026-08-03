import { useCallback, useEffect, useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'kwms.v1.theme'

function storedTheme(): Theme | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw === 'light' || raw === 'dark' ? raw : null
  } catch {
    return null
  }
}

/** Aufgelöstes Theme: gespeicherte Wahl, sonst System-Präferenz, sonst hell. */
export function resolveTheme(): Theme {
  const stored = storedTheme()
  if (stored) return stored
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

const listeners = new Set<() => void>()
let current: Theme = resolveTheme()

function setTheme(theme: Theme): void {
  current = theme
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Speicher voll/blockiert: Theme gilt trotzdem für die Session.
  }
  applyTheme(theme)
  listeners.forEach((cb) => cb())
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Theme lesen + umschalten; hält die `dark`-Klasse auf <html> synchron. */
export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const theme = useSyncExternalStore(subscribe, () => current)
  useEffect(() => applyTheme(theme), [theme])
  const toggleTheme = useCallback(() => setTheme(current === 'dark' ? 'light' : 'dark'), [])
  return { theme, toggleTheme }
}
