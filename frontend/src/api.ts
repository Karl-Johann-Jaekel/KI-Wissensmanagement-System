import type { GraphData, GraphSource } from './types'

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:8000'

/** Query string für `GET /graph` — `source: 'all'` bleibt weg, das ist der Default. */
export function graphQuery(includePending: boolean, source: GraphSource = 'all'): string {
  const params = new URLSearchParams({ include_pending: String(includePending) })
  if (source !== 'all') params.set('source', source)
  return params.toString()
}

/** Fetch the knowledge graph (pending nodes only visible with an admin key). */
export async function fetchGraph(
  includePending = false,
  apiKey?: string | null,
  source: GraphSource = 'all',
): Promise<GraphData> {
  const res = await fetch(`${BASE}/graph?${graphQuery(includePending, source)}`, {
    headers: apiKey ? { 'X-API-Key': apiKey } : {},
  })
  if (!res.ok) throw new Error(`graph: HTTP ${res.status}`)
  return (await res.json()) as GraphData
}

// ---------------------------------------------------------------- chat (SSE)

export interface ChatSource {
  title?: string
  uri?: string | null
  section?: string | null
  chunk_id?: string
  preview?: string
  repo?: string
  url?: string
}

export interface StreamHandlers {
  onToken: (text: string) => void
  onSources: (sources: ChatSource[], model?: string) => void
  onDone: () => void
  onError: (message: string) => void
}

/**
 * Dispatch one SSE event block to the handlers. Returns true when the stream
 * signalled [DONE]. Exported for tests.
 */
export function handleSseEvent(event: string, handlers: StreamHandlers): boolean {
  const line = event.trim()
  if (!line.startsWith('data:')) return false
  const payload = line.slice(5).trim()
  if (payload === '[DONE]') return true
  try {
    const obj = JSON.parse(payload) as {
      type?: string
      text?: string
      sources?: ChatSource[]
      model?: string
    }
    if (obj.type === 'token' && obj.text) handlers.onToken(obj.text)
    else if (obj.type === 'sources' && obj.sources)
      handlers.onSources(obj.sources, obj.model)
  } catch {
    // ignore malformed event
  }
  return false
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
      if (handleSseEvent(event, handlers)) {
        handlers.onDone()
        return
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

export interface DocumentDetail {
  id: string
  title: string
  source_type: string
  lang: string
  uri: string | null
  meta: Record<string, unknown>
  created_at: string
  chunks: number
  content: string
  content_source: 'stored' | 'reassembled'
  editable: boolean
}

export async function fetchDocument(id: string, apiKey?: string | null): Promise<DocumentDetail> {
  const res = await fetch(`${BASE}/documents/${id}`, {
    headers: apiKey ? { 'X-API-Key': apiKey } : {},
  })
  if (!res.ok) throw new Error(`document: HTTP ${res.status}`)
  return (await res.json()) as DocumentDetail
}

/** Upload a PDF or Markdown file (raw bytes, admin-only). */
export async function uploadDocument(
  file: File,
  apiKey: string,
): Promise<{ filename: string; status: string; chunks: number }> {
  const isMarkdown = file.name.toLowerCase().endsWith('.md')
  const params = new URLSearchParams({ filename: file.name })
  const res = await fetch(`${BASE}/ingest?${params}`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': isMarkdown ? 'text/markdown' : 'application/pdf',
    },
    body: file,
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Upload fehlgeschlagen (HTTP ${res.status}): ${detail}`)
  }
  return res.json()
}

export async function updateDocumentContent(
  id: string,
  content: string,
  apiKey: string,
): Promise<{ id: string; status: string; chunks: number }> {
  const res = await fetch(`${BASE}/documents/${id}/content`, {
    method: 'PUT',
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Speichern fehlgeschlagen (HTTP ${res.status}): ${detail}`)
  }
  return res.json()
}

export async function deleteDocument(id: string, apiKey: string): Promise<void> {
  const res = await fetch(`${BASE}/documents/${id}`, {
    method: 'DELETE',
    headers: { 'X-API-Key': apiKey },
  })
  if (!res.ok) throw new Error(`Löschen fehlgeschlagen (HTTP ${res.status})`)
}

// ---------------------------------------------------------------- search

export interface SearchHitRow {
  chunk_id: string
  document_id: string
  title: string
  uri: string | null
  content: string
  scores: Record<string, number | null>
}

export async function postSearch(
  query: string,
  options: { topK?: number; rerank?: boolean | null } = {},
  apiKey?: string | null,
): Promise<SearchHitRow[]> {
  const res = await fetch(`${BASE}/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'X-API-Key': apiKey } : {}),
    },
    body: JSON.stringify({
      query,
      top_k: options.topK ?? 5,
      rerank: options.rerank ?? null,
    }),
  })
  if (!res.ok) throw new Error(`search: HTTP ${res.status}`)
  return ((await res.json()) as { hits: SearchHitRow[] }).hits
}

// -------------------------------------------------- living knowledge (Phase 8)

export interface ChangelogItem {
  id: string
  kind: string
  name: string
  first_seen: string
}

export async function fetchChangelog(days = 7): Promise<ChangelogItem[]> {
  const res = await fetch(`${BASE}/graph/changelog?days=${days}`)
  if (!res.ok) throw new Error(`changelog: HTTP ${res.status}`)
  return (await res.json()).items as ChangelogItem[]
}

export interface PendingItem {
  id: string
  kind: string
  name: string
  sources: number
  confidence: number
  first_seen: string
}

export async function fetchReview(apiKey: string): Promise<PendingItem[]> {
  const res = await fetch(`${BASE}/review`, { headers: { 'X-API-Key': apiKey } })
  if (!res.ok) throw new Error(`review: HTTP ${res.status}`)
  return (await res.json()).pending as PendingItem[]
}

export async function reviewNode(
  id: string,
  action: 'verify' | 'reject',
  apiKey: string,
): Promise<void> {
  const res = await fetch(`${BASE}/review/node/${id}?action=${action}`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey },
  })
  if (!res.ok) throw new Error(`review ${action}: HTTP ${res.status}`)
}

export interface BulkReviewResult {
  action: 'verify' | 'reject'
  processed: number
  edges_verified: number
  not_found: string[]
}

/** Sammelfreigabe: mehrere pending-Fakten in einem Aufruf. */
export async function reviewBulk(
  ids: string[],
  action: 'verify' | 'reject',
  apiKey: string,
): Promise<BulkReviewResult> {
  const res = await fetch(`${BASE}/review/bulk`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, action }),
  })
  if (!res.ok) throw new Error(`review bulk ${action}: HTTP ${res.status}`)
  return (await res.json()) as BulkReviewResult
}
