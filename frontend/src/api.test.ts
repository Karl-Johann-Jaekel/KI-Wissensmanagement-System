import { describe, expect, it, vi } from 'vitest'
import { handleSseEvent, type StreamHandlers } from './api'

function makeHandlers(): StreamHandlers & {
  tokens: string[]
} {
  const tokens: string[] = []
  return {
    tokens,
    onToken: (t) => tokens.push(t),
    onSources: vi.fn(),
    onDone: vi.fn(),
    onError: vi.fn(),
  }
}

describe('handleSseEvent', () => {
  it('dispatches token events', () => {
    const h = makeHandlers()
    expect(handleSseEvent('data: {"type":"token","text":"Hallo "}', h)).toBe(false)
    expect(handleSseEvent('data: {"type":"token","text":"Welt"}', h)).toBe(false)
    expect(h.tokens.join('')).toBe('Hallo Welt')
  })

  it('dispatches sources with zone and model', () => {
    const h = makeHandlers()
    handleSseEvent(
      'data: {"type":"sources","zone":"public","model":"qwen3:8b","sources":[{"title":"RAG"}]}',
      h,
    )
    expect(h.onSources).toHaveBeenCalledWith([{ title: 'RAG' }], 'public', 'qwen3:8b')
  })

  it('signals DONE', () => {
    const h = makeHandlers()
    expect(handleSseEvent('data: [DONE]', h)).toBe(true)
  })

  it('ignores malformed payloads and non-data lines', () => {
    const h = makeHandlers()
    expect(handleSseEvent('data: {not json', h)).toBe(false)
    expect(handleSseEvent(': keepalive comment', h)).toBe(false)
    expect(h.tokens).toEqual([])
    expect(h.onError).not.toHaveBeenCalled()
  })
})
