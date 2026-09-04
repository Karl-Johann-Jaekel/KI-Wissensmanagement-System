import type { GraphData, GraphSource } from './types'

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:8000'

/**
 * Fehlgeschlagene Antwort → Satz, mit dem ein Besucher etwas anfangen kann.
 *
 * Vorher stand in der Oberfläche wörtlich `documents: HTTP 429` — ein Code, der
 * weder sagt, was los ist, noch was zu tun wäre. Bei 429 schickt der Server ein
 * `Retry-After` mit; das wird hier zur Wartezeit im Klartext.
 */
export function apiError(res: Response, was: string): Error {
  if (res.status === 429) {
    const wait = Number(res.headers.get('Retry-After'))
    const wann =
      Number.isFinite(wait) && wait > 0
        ? `Bitte in ${wait} Sekunde${wait === 1 ? '' : 'n'} noch einmal versuchen.`
        : 'Bitte einen Moment warten und es noch einmal versuchen.'
    return new Error(`Zu viele Anfragen in kurzer Zeit. ${wann}`)
  }
  if (res.status === 404) return new Error(`${was} wurde nicht gefunden.`)
  if (res.status >= 500) {
    return new Error(`${was} — der Server antwortet gerade nicht (HTTP ${res.status}).`)
  }
  return new Error(`${was} konnte nicht geladen werden (HTTP ${res.status}).`)
}

/** Query string für `GET /graph` — `source: 'all'` bleibt weg, das ist der Default. */
export function graphQuery(includePending: boolean, source: GraphSource = 'all'): string {
  const params = new URLSearchParams({ include_pending: String(includePending) })
  if (source !== 'all') params.set('source', source)
  return params.toString()
}

/** Fetch the knowledge graph. */
export async function fetchGraph(
  includePending = false,
  source: GraphSource = 'all',
): Promise<GraphData> {
  const res = await fetch(`${BASE}/graph?${graphQuery(includePending, source)}`)
  if (!res.ok) throw apiError(res, 'Der Wissens-Graph')
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
      message?: string
    }
    if (obj.type === 'token' && obj.text) handlers.onToken(obj.text)
    else if (obj.type === 'sources' && obj.sources)
      handlers.onSources(obj.sources, obj.model)
    // Der Anbieter hat mitten im Strom abgewiesen (ADR-0021). Die Kopfzeilen
    // waren da laengst raus, deshalb kommt der Fehler als Ereignis statt als
    // Statuscode — ohne diesen Zweig bliebe die Antwort wortlos stehen.
    else if (obj.type === 'error' && obj.message) handlers.onError(obj.message)
  } catch {
    // ignore malformed event
  }
  return false
}

/**
 * POST to an SSE chat endpoint and dispatch token/sources events.
 *
 * `signal` bricht den Abruf ab. Ohne ihn lief die Antwort weiter, wenn der
 * Nutzer wegnavigierte: das Modell erzeugte zu Ende, die Verbindung blieb
 * offen, und `onDone` feuerte auf eine nicht mehr sichtbare Ansicht.
 */
export async function streamChat(
  path: string,
  body: Record<string, unknown>,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch (err) {
    // Ein Abbruch ist kein Fehler, den der Nutzer sehen muss.
    if (signal?.aborted) return
    handlers.onError(err instanceof Error ? err.message : String(err))
    return
  }
  if (!res.ok || !res.body) {
    // Body verwerfen, sonst bleibt die Verbindung bis zum Timeout offen.
    await res.body?.cancel().catch(() => {})
    handlers.onError(apiError(res, 'Die Antwort').message)
    return
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
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
  } catch (err) {
    if (signal?.aborted) return
    handlers.onError(err instanceof Error ? err.message : String(err))
    return
  } finally {
    // Reader schliessen, damit ein abgebrochener Strom die Verbindung freigibt.
    await reader.cancel().catch(() => {})
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

export async function fetchDocuments(): Promise<DocumentRow[]> {
  const res = await fetch(`${BASE}/documents`)
  if (!res.ok) throw apiError(res, 'Die Dokumentliste')
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

export async function fetchDocument(id: string): Promise<DocumentDetail> {
  const res = await fetch(`${BASE}/documents/${id}`)
  if (!res.ok) throw apiError(res, 'Das Dokument')
  return (await res.json()) as DocumentDetail
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
): Promise<SearchHitRow[]> {
  const res = await fetch(`${BASE}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      top_k: options.topK ?? 5,
      rerank: options.rerank ?? null,
    }),
  })
  if (!res.ok) throw apiError(res, 'Die Suche')
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
  if (!res.ok) throw apiError(res, 'Die Neuigkeiten')
  return (await res.json()).items as ChangelogItem[]
}

