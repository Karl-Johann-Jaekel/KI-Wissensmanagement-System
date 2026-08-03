import type { GraphData } from './types'

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:8000'

/** Fetch the knowledge graph (pending nodes only visible with an admin key). */
export async function fetchGraph(
  includePending = false,
  apiKey?: string | null,
): Promise<GraphData> {
  const res = await fetch(`${BASE}/graph?include_pending=${includePending}`, {
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
  sensitivity?: string
  preview?: string
  repo?: string
  url?: string
}

export interface StreamHandlers {
  onToken: (text: string) => void
  onSources: (sources: ChatSource[], zone?: string, model?: string) => void
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
          model?: string
        }
        if (obj.type === 'token' && obj.text) handlers.onToken(obj.text)
        else if (obj.type === 'sources' && obj.sources)
          handlers.onSources(obj.sources, obj.zone, obj.model)
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

export interface DocumentDetail {
  id: string
  title: string
  source_type: string
  sensitivity: string
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
  sensitivity: string,
  apiKey: string,
): Promise<{ filename: string; status: string; chunks: number }> {
  const isMarkdown = file.name.toLowerCase().endsWith('.md')
  const params = new URLSearchParams({ filename: file.name, sensitivity })
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

// ---------------------------------------------------------------- models

export interface ModelsInfo {
  available: boolean
  default: string
  models: { name: string; parameter_size?: string | null; size?: number | null }[]
}

export async function fetchModels(apiKey: string): Promise<ModelsInfo> {
  const res = await fetch(`${BASE}/models`, { headers: { 'X-API-Key': apiKey } })
  if (!res.ok) throw new Error(`models: HTTP ${res.status}`)
  return (await res.json()) as ModelsInfo
}

// ---------------------------------------------------------------- search

export interface SearchHitRow {
  chunk_id: string
  document_id: string
  title: string
  uri: string | null
  sensitivity: string
  content: string
  scores: Record<string, number | null>
}

export async function postSearch(
  query: string,
  options: { topK?: number; maxSensitivity?: string; rerank?: boolean | null } = {},
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
      max_sensitivity: options.maxSensitivity ?? 'public',
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
