import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chatTitleFrom,
  createChat,
  DEFAULT_TOP_K,
  deleteChat,
  deleteProject,
  deleteSkill,
  getAdminKey,
  getChatMessages,
  getChatMeta,
  listChats,
  listProjects,
  listSkills,
  MAX_CHATS,
  MAX_MESSAGES_PER_CHAT,
  newId,
  renameChat,
  saveChat,
  saveProject,
  saveSkill,
  setAdminKey,
} from './storage'

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('admin key', () => {
  it('migrates the legacy key on first read', () => {
    localStorage.setItem('kwms-admin-key', 'secret')
    expect(getAdminKey()).toBe('secret')
    expect(localStorage.getItem('kwms-admin-key')).toBeNull()
    expect(localStorage.getItem('kwms.v1.adminKey')).toBe(JSON.stringify('secret'))
  })

  it('set/clear roundtrip', () => {
    setAdminKey('abc')
    expect(getAdminKey()).toBe('abc')
    setAdminKey(null)
    expect(getAdminKey()).toBeNull()
  })
})

describe('chats', () => {
  it('create + save + list roundtrip, sorted by updatedAt', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const a = createChat({ title: 'A' })
    vi.setSystemTime(2_000)
    const b = createChat({ title: 'B' })
    vi.setSystemTime(3_000)
    saveChat(b, [{ role: 'user', text: 'hi' }])
    vi.useRealTimers()
    const chats = listChats()
    expect(chats.map((c) => c.title)[0]).toBe('B')
    expect(chats).toHaveLength(2)
    expect(getChatMessages(b.id)).toEqual([{ role: 'user', text: 'hi' }])
    expect(getChatMessages(a.id)).toEqual([])
  })

  it('defaults retrieval settings and keeps overrides', () => {
    expect(createChat({}).topK).toBe(DEFAULT_TOP_K)
    expect(createChat({}).rerank).toBe(false)
    const tuned = createChat({ topK: 10, rerank: true })
    expect(getChatMeta(tuned.id)).toMatchObject({ topK: 10, rerank: true })
  })

  it('rename and delete', () => {
    const meta = createChat({ title: 'alt' })
    renameChat(meta.id, 'neu')
    expect(listChats()[0].title).toBe('neu')
    deleteChat(meta.id)
    expect(listChats()).toHaveLength(0)
    expect(getChatMessages(meta.id)).toEqual([])
  })

  it('prunes oldest chats beyond MAX_CHATS', () => {
    for (let i = 0; i < MAX_CHATS + 5; i++) createChat({ title: `c${i}` })
    expect(listChats()).toHaveLength(MAX_CHATS)
  })

  it('trims messages to MAX_MESSAGES_PER_CHAT', () => {
    const meta = createChat({})
    const messages = Array.from({ length: MAX_MESSAGES_PER_CHAT + 20 }, (_, i) => ({
      role: 'user' as const,
      text: `m${i}`,
    }))
    saveChat(meta, messages)
    const stored = getChatMessages(meta.id)
    expect(stored).toHaveLength(MAX_MESSAGES_PER_CHAT)
    expect(stored[stored.length - 1].text).toBe(`m${MAX_MESSAGES_PER_CHAT + 19}`)
  })

  it('reports false on quota errors instead of throwing', () => {
    const meta = createChat({})
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    expect(saveChat(meta, [{ role: 'user', text: 'x' }])).toBe(false)
  })

  it('derives titles from the first message', () => {
    expect(chatTitleFrom('Was ist RRF?')).toBe('Was ist RRF?')
    expect(chatTitleFrom('x'.repeat(80))).toHaveLength(61)
    expect(chatTitleFrom('   ')).toBe('Neuer Chat')
  })
})

describe('skills', () => {
  it('save/update/delete', () => {
    const skill = saveSkill({ id: newId(), name: 'S', content: 'tu was' })
    expect(listSkills()).toHaveLength(1)
    saveSkill({ ...skill, content: 'anders' })
    expect(listSkills()[0].content).toBe('anders')
    deleteSkill(skill.id)
    expect(listSkills()).toHaveLength(0)
  })
})

describe('projects', () => {
  it('save/list/delete and chat unlink', () => {
    const chat = createChat({ title: 'im Projekt' })
    saveProject({
      id: 'p1',
      name: 'Projekt',
      description: '',
      chatIds: [chat.id],
      documentIds: ['d1'],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    expect(listProjects()).toHaveLength(1)
    deleteChat(chat.id)
    expect(listProjects()[0].chatIds).toEqual([])
    deleteProject('p1')
    expect(listProjects()).toHaveLength(0)
  })
})
