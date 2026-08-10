/**
 * Einstellungen des Graph-Explorers — im versionierten localStorage (ADR-0006),
 * damit Layout, Slider und die Position des Menüs einen Reload überleben.
 */
import { getGraphPrefs, setGraphPrefs } from '../../lib/storage'
import type { LayoutId } from './layouts'
import type { GroupMode } from './scene'

export interface GraphSettings {
  layout: LayoutId
  groupMode: GroupMode
  /** Kern, Projekte und Dienste einblenden. */
  showSystem: boolean
  /** Knoten-Namen dauerhaft zeichnen (sonst nur bei Hover/Auswahl). */
  labels: boolean
  /** Cluster- und Ebenen-Beschriftungen. */
  hubLabels: boolean
  minimap: boolean
  /** Kanten erst beim Überfahren zeigen — hält das Bild ruhig. */
  linksOnHover: boolean
  nodeSize: number
  clusterGap: number
  spread: number
  detail: number
  /** Drift und Globus-Rotation (respektiert zusätzlich prefers-reduced-motion). */
  motion: boolean
}

export interface GraphPrefs {
  settings: GraphSettings
  panel: { x: number; y: number } | null
}

export const DEFAULT_SETTINGS: GraphSettings = {
  layout: 'cloud',
  groupMode: 'kind',
  showSystem: true,
  labels: false,
  hubLabels: true,
  minimap: true,
  linksOnHover: true,
  nodeSize: 1,
  clusterGap: 10,
  spread: 1.45,
  detail: 5,
  motion: true,
}

export const SLIDERS = {
  nodeSize: { min: 0.4, max: 2, step: 0.1, label: 'Knoten-Größe' },
  clusterGap: { min: 0, max: 20, step: 1, label: 'Cluster-Abstand' },
  spread: { min: 0.5, max: 3, step: 0.05, label: 'Streuung' },
  detail: { min: 1, max: 5, step: 1, label: 'Detail-Tiefe' },
} as const

const LAYOUT_IDS: LayoutId[] = ['cloud', 'globe', 'ring', 'layers']

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(max, Math.max(min, n))
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** Gespeicherte Werte tolerant übernehmen — alte/kaputte Stände fallen auf Defaults zurück. */
export function normalizeSettings(raw: unknown): GraphSettings {
  const s = (raw ?? {}) as Partial<GraphSettings>
  return {
    layout: LAYOUT_IDS.includes(s.layout as LayoutId) ? (s.layout as LayoutId) : DEFAULT_SETTINGS.layout,
    groupMode: s.groupMode === 'cluster' ? 'cluster' : 'kind',
    showSystem: bool(s.showSystem, DEFAULT_SETTINGS.showSystem),
    labels: bool(s.labels, DEFAULT_SETTINGS.labels),
    hubLabels: bool(s.hubLabels, DEFAULT_SETTINGS.hubLabels),
    minimap: bool(s.minimap, DEFAULT_SETTINGS.minimap),
    linksOnHover: bool(s.linksOnHover, DEFAULT_SETTINGS.linksOnHover),
    nodeSize: clamp(s.nodeSize, DEFAULT_SETTINGS.nodeSize, SLIDERS.nodeSize.min, SLIDERS.nodeSize.max),
    clusterGap: clamp(
      s.clusterGap,
      DEFAULT_SETTINGS.clusterGap,
      SLIDERS.clusterGap.min,
      SLIDERS.clusterGap.max,
    ),
    spread: clamp(s.spread, DEFAULT_SETTINGS.spread, SLIDERS.spread.min, SLIDERS.spread.max),
    detail: Math.round(clamp(s.detail, DEFAULT_SETTINGS.detail, SLIDERS.detail.min, SLIDERS.detail.max)),
    motion: bool(s.motion, DEFAULT_SETTINGS.motion),
  }
}

function normalizePanel(raw: unknown): { x: number; y: number } | null {
  const p = raw as { x?: unknown; y?: unknown } | null | undefined
  if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') return null
  return { x: p.x, y: p.y }
}

export function loadPrefs(): GraphPrefs {
  const raw = getGraphPrefs<Partial<GraphPrefs>>({})
  return { settings: normalizeSettings(raw.settings), panel: normalizePanel(raw.panel) }
}

export function savePrefs(prefs: GraphPrefs): boolean {
  return setGraphPrefs(prefs)
}
