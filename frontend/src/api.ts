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
