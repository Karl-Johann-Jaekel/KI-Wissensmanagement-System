/**
 * Verschiebbares Menü des Graph-Explorers: Suche, Layoutwahl, Ansicht-Schalter,
 * Regler und Filter. Liegt über dem Canvas und lässt sich am Kopf greifen —
 * die Position überlebt den Reload (localStorage).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, Minus, Search } from 'lucide-react'
import type { ChangelogItem } from '../../api'
import { cn } from '../../lib/cn'
import { GRAPH_SOURCES, type GraphSource } from '../../types'
import { LAYOUTS } from './layouts'
import type { SceneGroup } from './scene'
import { SLIDERS, type GraphSettings } from './settings'

interface Props {
  nodeCount: number
  matchCount: number | null
  query: string
  onQuery: (value: string) => void
  onSubmitQuery: () => void
  settings: GraphSettings
  onChange: (patch: Partial<GraphSettings>) => void
  groups: SceneGroup[]
  collapsed: Set<string>
  onToggleGroup: (id: string) => void
  onExpandAll: () => void
  onCollapseAll: () => void
  filterDays: number | null
  onFilterDays: (days: number | null) => void
  source: GraphSource
  onSource: (source: GraphSource) => void
  changelog: ChangelogItem[]
  position: { x: number; y: number } | null
  onPosition: (pos: { x: number; y: number }) => void
}

/** Auch der Canvas braucht das Maß: er passt den Graphen daneben ein. */
export const PANEL_WIDTH = 232

function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 768,
  )
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const update = () => setDesktop(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return desktop
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">{title}</div>
      {children}
    </div>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
        active
          ? 'bg-primary-600 text-white dark:bg-primary-500 dark:text-primary-950'
          : 'border border-edge bg-surface text-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[11px] text-ink">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-primary-600"
      />
      {label}
    </label>
  )
}

function Slider({
  id,
  value,
  onChange,
  format,
}: {
  id: keyof typeof SLIDERS
  value: number
  onChange: (value: number) => void
  format?: (value: number) => string
}) {
  const spec = SLIDERS[id]
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] text-muted">
        {spec.label} {format ? format(value) : value}
      </span>
      <input
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-full cursor-pointer accent-primary-600"
      />
    </label>
  )
}

export default function ControlPanel({
  nodeCount,
  matchCount,
  query,
  onQuery,
  onSubmitQuery,
  settings,
  onChange,
  groups,
  collapsed,
  onToggleGroup,
  onExpandAll,
  onCollapseAll,
  filterDays,
  onFilterDays,
  source,
  onSource,
  changelog,
  position,
  onPosition,
}: Props) {
  const desktop = useIsDesktop()
  const [open, setOpen] = useState(true)
  const [pos, setPos] = useState(position ?? { x: 16, y: 16 })
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (position) setPos(position)
  }, [position])

  // Ohne gespeicherte Position startet das Menü oben rechts; beim Verkleinern
  // des Fensters rutscht es zurück in die Fläche.
  useEffect(() => {
    const clamp = () => {
      const parent = panelRef.current?.parentElement?.getBoundingClientRect()
      if (!parent) return
      setPos((prev) => {
        const start = position ?? { x: Math.max(8, parent.width - PANEL_WIDTH - 16), y: 16 }
        const source = position ? prev : start
        return {
          x: Math.min(source.x, Math.max(0, parent.width - PANEL_WIDTH)),
          y: Math.min(source.y, Math.max(0, parent.height - 48)),
        }
      })
    }
    clamp()
    window.addEventListener('resize', clamp)
    return () => window.removeEventListener('resize', clamp)
  }, [position])

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!desktop) return
      const parent = panelRef.current?.parentElement?.getBoundingClientRect()
      if (!parent) return
      dragRef.current = { dx: e.clientX - parent.left - pos.x, dy: e.clientY - parent.top - pos.y }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    [desktop, pos],
  )

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current
    const parent = panelRef.current?.parentElement?.getBoundingClientRect()
    if (!drag || !parent) return
    // In der Fläche halten, damit das Menü nicht aus dem Canvas rutscht.
    const x = Math.min(
      Math.max(0, e.clientX - parent.left - drag.dx),
      Math.max(0, parent.width - PANEL_WIDTH),
    )
    const y = Math.min(Math.max(0, e.clientY - parent.top - drag.dy), Math.max(0, parent.height - 48))
    setPos({ x, y })
  }, [])

  const endDrag = useCallback(() => {
    if (!dragRef.current) return
    dragRef.current = null
    onPosition(pos)
  }, [onPosition, pos])

  const placement = desktop
    ? { left: pos.x, top: pos.y, width: PANEL_WIDTH }
    : { left: 8, right: 8, top: 8 }

  return (
    <div
      ref={panelRef}
      style={placement}
      className="absolute z-20 rounded-xl border border-edge bg-surface/95 shadow-xl backdrop-blur"
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={cn(
          'flex items-center justify-between rounded-t-xl px-3 py-2',
          desktop && 'cursor-grab active:cursor-grabbing',
        )}
      >
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Menü</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Menü einklappen' : 'Menü ausklappen'}
          className="rounded p-0.5 text-muted hover:bg-sunken hover:text-ink"
        >
          {open ? <Minus className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>

      {open && (
        <div className="flex max-h-[calc(100vh-9rem)] flex-col gap-3 overflow-y-auto px-3 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onSubmitQuery()}
              placeholder={`${nodeCount} Knoten durchsuchen …`}
              className={cn(
                'w-full rounded-lg border border-edge bg-sunken py-1.5 pl-7 pr-2 text-[11px] text-ink',
                'placeholder:text-muted focus:border-primary-500 focus:outline-none',
              )}
            />
            {matchCount !== null && (
              <div className="mt-1 text-[10px] text-muted">
                {matchCount} Treffer · Enter springt zum ersten
              </div>
            )}
          </div>

          <Section title="Layout">
            <div className="flex flex-wrap gap-1">
              {LAYOUTS.map((l) => (
                <Chip
                  key={l.id}
                  active={settings.layout === l.id}
                  onClick={() => onChange({ layout: l.id })}
                >
                  {l.label}
                </Chip>
              ))}
            </div>
          </Section>

          <Section title="Ansicht">
            <div className="flex flex-wrap gap-1">
              <Chip
                active={settings.groupMode === 'kind'}
                onClick={() => onChange({ groupMode: 'kind' })}
              >
                Typen
              </Chip>
              <Chip
                active={settings.groupMode === 'cluster'}
                onClick={() => onChange({ groupMode: 'cluster' })}
              >
                Themen
              </Chip>
            </div>
            <Toggle
              checked={settings.labels}
              onChange={(v) => onChange({ labels: v })}
              label="Knoten-Namen"
            />
            <Toggle
              checked={settings.hubLabels}
              onChange={(v) => onChange({ hubLabels: v })}
              label="Cluster-Namen"
            />
            <Toggle
              checked={settings.minimap}
              onChange={(v) => onChange({ minimap: v })}
              label="Minimap"
            />
            <Toggle
              checked={settings.linksOnHover}
              onChange={(v) => onChange({ linksOnHover: v })}
              label="Kanten nur bei Hover"
            />
            <Toggle
              checked={settings.showSystem}
              onChange={(v) => onChange({ showSystem: v })}
              label="Systemebenen"
            />
            <Toggle
              checked={settings.motion}
              onChange={(v) => onChange({ motion: v })}
              label="Bewegung"
            />
            <Toggle
              checked={settings.glow}
              onChange={(v) => onChange({ glow: v })}
              label="Leuchten (dunkles Theme)"
            />
          </Section>

          <Section title="Regler">
            <Slider
              id="nodeSize"
              value={settings.nodeSize}
              onChange={(v) => onChange({ nodeSize: v })}
              format={(v) => v.toFixed(1)}
            />
            <Slider
              id="clusterGap"
              value={settings.clusterGap}
              onChange={(v) => onChange({ clusterGap: v })}
            />
            <Slider
              id="spread"
              value={settings.spread}
              onChange={(v) => onChange({ spread: v })}
              format={(v) => v.toFixed(2)}
            />
            <Slider id="detail" value={settings.detail} onChange={(v) => onChange({ detail: v })} />
          </Section>

          <Section title="Cluster">
            <div className="flex gap-1">
              <Chip active={false} onClick={onExpandAll}>
                Alle expandieren
              </Chip>
              <Chip active={false} onClick={onCollapseAll}>
                Alle kollabieren
              </Chip>
            </div>
            <ul className="flex flex-col gap-0.5">
              {groups.map((g) => (
                <li key={g.id}>
                  <button
                    type="button"
                    onClick={() => onToggleGroup(g.id)}
                    title={collapsed.has(g.id) ? 'Aufklappen' : 'Zusammenfassen'}
                    className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-[11px] text-muted hover:bg-sunken hover:text-ink"
                  >
                    <span
                      className={cn(
                        'inline-block h-2.5 w-2.5 shrink-0 rounded-full',
                        collapsed.has(g.id) && 'ring-2 ring-offset-1 ring-offset-surface',
                      )}
                      style={{ backgroundColor: g.color }}
                    />
                    <span className="truncate">{g.label}</span>
                    <span className="ml-auto tabular-nums">{g.count}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Filter">
            <label className="flex items-center justify-between text-[11px] text-ink">
              Quelle
              <select
                value={source}
                onChange={(e) => onSource(e.target.value as GraphSource)}
                className="rounded border border-edge bg-surface px-1.5 py-0.5 text-[11px] text-ink focus:outline-none"
              >
                {GRAPH_SOURCES.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center justify-between text-[11px] text-ink">
              Neu
              <select
                value={filterDays ?? ''}
                onChange={(e) => onFilterDays(e.target.value ? Number(e.target.value) : null)}
                className="rounded border border-edge bg-surface px-1.5 py-0.5 text-[11px] text-ink focus:outline-none"
              >
                <option value="">alle</option>
                <option value="7">7 Tage</option>
                <option value="30">30 Tage</option>
              </select>
            </label>
          </Section>

          {changelog.length > 0 && (
            <Section title="Neu (7 Tage)">
              <ul className="flex max-h-32 flex-col gap-0.5 overflow-y-auto">
                {changelog.slice(0, 12).map((c) => (
                  <li key={c.id} className="truncate text-[11px] text-muted">
                    {c.name}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </div>
  )
}
