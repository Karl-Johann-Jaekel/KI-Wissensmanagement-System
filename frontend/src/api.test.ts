import { describe, expect, it, vi } from 'vitest'
import { graphQuery, handleSseEvent, type StreamHandlers } from './api'

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

  it('dispatches sources with the answering model', () => {
    const h = makeHandlers()
    handleSseEvent(
      'data: {"type":"sources","model":"mistral-medium-latest","sources":[{"title":"RAG"}]}',
      h,
    )
    expect(h.onSources).toHaveBeenCalledWith([{ title: 'RAG' }], 'mistral-medium-latest')
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

describe('graphQuery', () => {
  it('lässt die Standardquelle aus dem Query-String', () => {
    expect(graphQuery(false)).toBe('include_pending=false')
    expect(graphQuery(true)).toBe('include_pending=true')
  })

  it('hängt den Quellenfilter an, sobald er gesetzt ist', () => {
    expect(graphQuery(false, 'paperswithcode')).toBe(
      'include_pending=false&source=paperswithcode',
    )
    expect(graphQuery(true, 'native')).toBe('include_pending=true&source=native')
  })
})
