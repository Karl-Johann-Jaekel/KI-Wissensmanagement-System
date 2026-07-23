import type { GraphData, Scope } from './types'

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:8000'

/**
 * Fetch a graph from the backend. Falls back to a static ./graph.json bundled with
 * the site (PLAN §7 Phase 2: "läuft notfalls ohne Backend auf GitHub Pages").
 */
export async function fetchGraph(scope: Scope): Promise<GraphData> {
  try {
    const res = await fetch(`${BASE}/graph?scope=${scope}`)
    if (!res.ok) throw new Error(`graph ${scope}: HTTP ${res.status}`)
    return (await res.json()) as GraphData
  } catch (err) {
    const fallback = await fetch(`${import.meta.env.BASE_URL}graph.json`)
    if (!fallback.ok) throw err
    const all = (await fallback.json()) as Record<Scope, GraphData>
    return all[scope] ?? { nodes: [], links: [] }
  }
}

// ---------------------------------------------------------------- chat (SSE)

export interface ChatSource {
  title?: string
  uri?: string | null
  section?: string | null
  chunk_id?: string
  sensitivity?: string
  preview?: string
  repo?: string
  url?: string
}

export interface StreamHandlers {
  onToken: (text: string) => void
  onSources: (sources: ChatSource[], zone?: string) => void
  onDone: () => void
  onError: (message: string) => void
}

/** POST to an SSE chat endpoint and dispatch token/sources events. */
export async function streamChat(
  path: string,
  body: Record<string, unknown>,
  handlers: StreamHandlers,
  apiKey?: string | null,
): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-API-Key': apiKey } : {}),
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    handlers.onError(err instanceof Error ? err.message : String(err))
    return
  }
  if (!res.ok || !res.body) {
    handlers.onError(`HTTP ${res.status}`)
    return
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''
    for (const event of events) {
      const line = event.trim()
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') {
        handlers.onDone()
        return
      }
      try {
        const obj = JSON.parse(payload) as {
          type?: string
          text?: string
          sources?: ChatSource[]
          zone?: string
        }
        if (obj.type === 'token' && obj.text) handlers.onToken(obj.text)
        else if (obj.type === 'sources' && obj.sources) handlers.onSources(obj.sources, obj.zone)
      } catch {
        // ignore malformed event
      }
    }
  }
  handlers.onDone()
}

// ---------------------------------------------------------------- documents

export interface DocumentRow {
  id: string
  title: string
  source_type: string
  sensitivity: string
  lang: string
  uri: string | null
  chunks: number
}

export async function fetchDocuments(apiKey?: string | null): Promise<DocumentRow[]> {
  const res = await fetch(`${BASE}/documents`, {
    headers: apiKey ? { 'X-API-Key': apiKey } : {},
  })
  if (!res.ok) throw new Error(`documents: HTTP ${res.status}`)
  return (await res.json()) as DocumentRow[]
}

export async function uploadPdf(
  file: File,
  sensitivity: string,
  apiKey: string,
): Promise<{ filename: string; status: string; chunks: number }> {
  const params = new URLSearchParams({ filename: file.name, sensitivity })
  const res = await fetch(`${BASE}/ingest?${params}`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/pdf' },
    body: file,
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Upload fehlgeschlagen (HTTP ${res.status}): ${detail}`)
  }
  return res.json()
}
