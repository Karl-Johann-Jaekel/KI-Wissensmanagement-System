/**
 * Versionierter localStorage-Layer (ADR-0006): Chats, Skills, Projekte, Admin-Key.
 *
 * Alles bleibt im Browser des Nutzers — der Server speichert keine Konversationen
 * (DSGVO-freundlich, kein User-Modell nötig). Schreibfehler (Quota, blockierter
 * Storage) werfen nie: Lesen liefert Fallbacks, Schreiben meldet false.
 */
import { useSyncExternalStore } from 'react'
import type { ChatSource } from '../api'

const NS = 'kwms.v1.'
const LEGACY_ADMIN_KEY = 'kwms-admin-key'

export const MAX_CHATS = 100
export const MAX_MESSAGES_PER_CHAT = 200
export const DEFAULT_TOP_K = 5

export interface ChatMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  projectId: string | null
  /** Retrieval-Einstellungen; bei Chats aus früheren Versionen undefined. */
  topK?: number
  rerank?: boolean
}

export interface StoredMessage {
  role: 'user' | 'assistant'
  text: string
  sources?: ChatSource[]
  model?: string
  error?: string
}

export interface Skill {
  id: string
  name: string
  content: string
  createdAt: number
  updatedAt: number
}

export interface Project {
  id: string
  name: string
  description: string
  chatIds: string[]
  documentIds: string[]
  createdAt: number
  updatedAt: number
}

// ------------------------------------------------------------------ low level

const listeners = new Set<() => void>()

function emit(): void {
  listeners.forEach((cb) => cb())
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(NS + key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

/** Schreiben; false bei QuotaExceeded o. Ä. (Aufrufer kann Toast zeigen). */
function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(NS + key, JSON.stringify(value))
    emit()
    return true
  } catch {
    return false
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(NS + key)
  } catch {
    // ignorieren — Storage nicht verfügbar
  }
  emit()
}

export function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

// ------------------------------------------------------------------ admin key

export function getAdminKey(): string | null {
  const current = read<string | null>('adminKey', null)
  if (current) return current
  // Migration vom Vor-Redesign-Schlüssel.
  try {
    const legacy = localStorage.getItem(LEGACY_ADMIN_KEY)
    if (legacy) {
      write('adminKey', legacy)
      localStorage.removeItem(LEGACY_ADMIN_KEY)
      return legacy
    }
  } catch {
    return null
  }
  return null
}

export function setAdminKey(key: string | null): void {
  if (key) write('adminKey', key)
  else remove('adminKey')
}

// ------------------------------------------------------------------ chats

function chatIndex(): ChatMeta[] {
  return read<ChatMeta[]>('chats.index', [])
}

function writeChatIndex(index: ChatMeta[]): boolean {
  return write('chats.index', index)
}

export function listChats(): ChatMeta[] {
  return [...chatIndex()].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getChatMeta(id: string): ChatMeta | null {
  return chatIndex().find((c) => c.id === id) ?? null
}

export function getChatMessages(id: string): StoredMessage[] {
  return read<StoredMessage[]>(`chat.${id}`, [])
}

export function chatTitleFrom(text: string): string {
  const line = text.trim().split('\n')[0]
  return line.length > 60 ? `${line.slice(0, 60)}…` : line || 'Neuer Chat'
}

export function createChat(
  init: Partial<
    Pick<ChatMeta, 'title' | 'projectId' | 'topK' | 'rerank'>
  > = {},
): ChatMeta {
  const now = Date.now()
  const meta: ChatMeta = {
    id: newId(),
    title: init.title ?? 'Neuer Chat',
    createdAt: now,
    updatedAt: now,
    projectId: init.projectId ?? null,
    topK: init.topK ?? DEFAULT_TOP_K,
    rerank: init.rerank ?? false,
  }
  const index = chatIndex()
  index.push(meta)
  // Cap: älteste Chats fallen raus (inkl. ihrer Message-Keys).
  const sorted = [...index].sort((a, b) => b.updatedAt - a.updatedAt)
  for (const evicted of sorted.slice(MAX_CHATS)) {
    remove(`chat.${evicted.id}`)
  }
  writeChatIndex(sorted.slice(0, MAX_CHATS))
  return meta
}

/** Messages + Meta speichern; Messages werden auf MAX_MESSAGES_PER_CHAT beschnitten. */
export function saveChat(meta: ChatMeta, messages: StoredMessage[]): boolean {
  const trimmed = messages.slice(-MAX_MESSAGES_PER_CHAT)
  const index = chatIndex().filter((c) => c.id !== meta.id)
  index.push({ ...meta, updatedAt: Date.now() })
  const okIndex = writeChatIndex(index)
  const okMessages = write(`chat.${meta.id}`, trimmed)
  return okIndex && okMessages
}

export function renameChat(id: string, title: string): void {
  const index = chatIndex()
  const meta = index.find((c) => c.id === id)
  if (!meta) return
  meta.title = title.trim() || meta.title
  meta.updatedAt = Date.now()
  writeChatIndex(index)
}

export function deleteChat(id: string): void {
  writeChatIndex(chatIndex().filter((c) => c.id !== id))
  remove(`chat.${id}`)
  // Projekt-Verweise aufräumen.
  const projects = read<Project[]>('projects', [])
  const cleaned = projects.map((p) =>
    p.chatIds.includes(id) ? { ...p, chatIds: p.chatIds.filter((c) => c !== id) } : p,
  )
  write('projects', cleaned)
}

// ------------------------------------------------------------------ skills

export function listSkills(): Skill[] {
  return [...read<Skill[]>('skills', [])].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function saveSkill(skill: Omit<Skill, 'createdAt' | 'updatedAt'> & Partial<Skill>): Skill {
  const skills = read<Skill[]>('skills', [])
  const now = Date.now()
  const existing = skills.find((s) => s.id === skill.id)
  if (existing) {
    existing.name = skill.name
    existing.content = skill.content
    existing.updatedAt = now
    write('skills', skills)
    return existing
  }
  const created: Skill = { createdAt: now, updatedAt: now, ...skill } as Skill
  skills.push(created)
  write('skills', skills)
  return created
}

export function deleteSkill(id: string): void {
  write(
    'skills',
    read<Skill[]>('skills', []).filter((s) => s.id !== id),
  )
}

/** Beispiel-Skills beim allerersten Besuch (einmalig). */
export function seedSkillsOnce(): void {
  if (read<boolean>('skills.seeded', false)) return
  write('skills.seeded', true)
  if (read<Skill[]>('skills', []).length > 0) return
  const now = Date.now()
  write('skills', [
    {
      id: newId(),
      name: 'Zusammenfassen',
      content: 'Fasse die wichtigsten Aussagen zu folgendem Thema kompakt zusammen und nenne die Quellen: ',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: newId(),
      name: 'Konzept-Vergleich',
      content:
        'Vergleiche die folgenden zwei Konzepte anhand des Neuralen Gedächtnisses (Gemeinsamkeiten, Unterschiede, typische Anwendungsfälle): ',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: newId(),
      name: 'Einfach erklärt',
      content: 'Erkläre das folgende Konzept so, dass es jemand ohne ML-Hintergrund versteht, und belege mit Quellen: ',
      createdAt: now,
      updatedAt: now,
    },
  ] satisfies Skill[])
}

// ------------------------------------------------------------------ projects

export function listProjects(): Project[] {
  return [...read<Project[]>('projects', [])].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getProject(id: string): Project | null {
  return read<Project[]>('projects', []).find((p) => p.id === id) ?? null
}

export function saveProject(project: Project): boolean {
  const projects = read<Project[]>('projects', []).filter((p) => p.id !== project.id)
  projects.push({ ...project, updatedAt: Date.now() })
  return write('projects', projects)
}

export function deleteProject(id: string): void {
  write(
    'projects',
    read<Project[]>('projects', []).filter((p) => p.id !== id),
  )
  // Chats behalten, nur die Zuordnung lösen.
  const index = chatIndex()
  let changed = false
  for (const meta of index) {
    if (meta.projectId === id) {
      meta.projectId = null
      changed = true
    }
  }
  if (changed) writeChatIndex(index)
}

// ------------------------------------------------------------------ react hooks

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  const onStorage = (e: StorageEvent) => {
    if (e.key?.startsWith(NS)) cb()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', onStorage)
  }
}

function makeHook<T>(load: () => T): () => T {
  let cached = load()
  let cachedJson = JSON.stringify(cached)
  return function useStored(): T {
    return useSyncExternalStore(
      (cb) =>
        subscribe(() => {
          const next = load()
          const nextJson = JSON.stringify(next)
          if (nextJson !== cachedJson) {
            cached = next
            cachedJson = nextJson
          }
          cb()
        }),
      () => cached,
    )
  }
}

export const useChatIndex = makeHook(listChats)
export const useSkills = makeHook(listSkills)
export const useProjects = makeHook(listProjects)
