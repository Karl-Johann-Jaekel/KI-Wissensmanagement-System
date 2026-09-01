import { afterEach, describe, expect, it, vi } from 'vitest'
import { graphQuery, handleSseEvent, streamChat, type StreamHandlers } from './api'

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

  it('reicht Anbieterfehler aus dem Strom an onError weiter', () => {
    // Ein 429 kommt als Ereignis, nicht als Statuscode: die Kopfzeilen sind
    // zu diesem Zeitpunkt raus (ADR-0021). Ohne diesen Pfad bliebe die halb
    // geschriebene Antwort kommentarlos stehen.
    const h = makeHandlers()
    handleSseEvent('data: {"type":"error","message":"Das Sprachmodell ist ausgelastet."}', h)
    expect(h.onError).toHaveBeenCalledWith('Das Sprachmodell ist ausgelastet.')
    expect(h.tokens).toEqual([])
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


// ------------------------------------------------------- Abbruch (L7)

describe('streamChat: Abbruch', () => {
  const sseBody = (frames: string[]) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(frames.join('\n\n')))
        controller.close()
      },
    })

  const handlers = () => {
    const seen = { tokens: [] as string[], errors: [] as string[], done: 0 }
    return {
      seen,
      h: {
        onToken: (t: string) => seen.tokens.push(t),
        onSources: () => {},
        onError: (e: string) => seen.errors.push(e),
        onDone: () => {
          seen.done += 1
        },
      },
    }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('liefert Token und meldet den Abschluss', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(sseBody(['data: {"type":"token","text":"Hallo"}', 'data: [DONE]']), {
        status: 200,
      }),
    )
    const { seen, h } = handlers()
    await streamChat('/chat', { query: 'x' }, h)
    expect(seen.tokens).toEqual(['Hallo'])
    expect(seen.done).toBe(1)
    expect(seen.errors).toEqual([])
  })

  it('meldet einen Abbruch nicht als Fehler', async () => {
    // So verhaelt sich fetch mit einem bereits abgebrochenen Signal.
    vi.stubGlobal('fetch', async () => {
      throw new DOMException('The operation was aborted.', 'AbortError')
    })
    const controller = new AbortController()
    controller.abort()

    const { seen, h } = handlers()
    await streamChat('/chat', { query: 'x' }, h, controller.signal)

    // Der Nutzer hat selbst abgebrochen — keine Fehlermeldung, kein onDone.
    expect(seen.errors).toEqual([])
    expect(seen.done).toBe(0)
  })

  it('meldet einen echten Netzwerkfehler weiterhin', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })
    const { seen, h } = handlers()
    await streamChat('/chat', { query: 'x' }, h, new AbortController().signal)
    expect(seen.errors).toEqual(['Failed to fetch'])
  })
})
