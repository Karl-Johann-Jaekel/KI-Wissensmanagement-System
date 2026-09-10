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

/**
 * Höhe des zugeklappten Blattes auf dem Handy (Griff plus Zeile).
 *
 * Der Canvas hält diesen Streifen frei, damit der Graph nicht unter dem Griff
 * endet. Das ausgefahrene Blatt bleibt dagegen absichtlich unberücksichtigt:
 * Es liegt kurzzeitig darüber und würde die Kamera sonst bei jedem Öffnen
 * umrechnen.
 */
export const SHEET_HANDLE = 56

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
        // Grundmass ist der Finger (44 px); ab `md` wieder die kompakte
        // Desktop-Groesse, die dort seit jeher gilt.
        'inline-flex min-h-11 items-center rounded-md px-3 text-xs font-medium transition-colors',
        'pointer-fine:min-h-0 pointer-fine:px-2 pointer-fine:py-1 pointer-fine:text-[11px]',
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
    <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-xs text-ink pointer-fine:min-h-0 pointer-fine:gap-2 pointer-fine:text-[11px]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 shrink-0 accent-primary-600 pointer-fine:h-3.5 pointer-fine:w-3.5"
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
      <span className="text-[11px] text-muted pointer-fine:text-[10px]">
        {spec.label} {format ? format(value) : value}
      </span>
      <input
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        // Eine hohe Spur ist auf dem Handy der ganze Unterschied: der Griff
        // eines `range` ist winzig, die Trefferflaeche folgt der Elementhoehe.
        className="h-11 w-full cursor-pointer accent-primary-600 pointer-fine:h-1"
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
  // Auf dem Handy startet das Menue zu. Offen belegte es die ganze Flaeche —
  // vom Graphen war nichts zu sehen, und genau dafuer ist die Seite da.
  const [open, setOpen] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= 768,
  )
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

  const layoutLabel = LAYOUTS.find((l) => l.id === settings.layout)?.label ?? settings.layout

  return (
    <>
      {/* Auf dem Handy legt sich das offene Blatt ueber den Graphen; ein Tipp
          daneben schliesst es wieder. */}
      {open && !desktop && (
        <div
          className="absolute inset-0 z-10 bg-black/40"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}
      <div
        ref={panelRef}
        style={desktop ? { left: pos.x, top: pos.y, width: PANEL_WIDTH } : undefined}
        className={cn(
          'absolute z-20 border-edge bg-surface/95 shadow-xl backdrop-blur',
          desktop
            ? 'rounded-xl border'
            : // Blatt am unteren Rand: der Griff bleibt sichtbar, der Rest faehrt aus.
              'inset-x-0 bottom-0 rounded-t-2xl border-t',
        )}
      >
        {desktop ? (
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className="flex cursor-grab items-center justify-between rounded-t-xl px-3 py-2 active:cursor-grabbing"
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              Menü
            </span>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? 'Menü einklappen' : 'Menü ausklappen'}
              className="-m-2 inline-flex h-11 w-11 items-center justify-center rounded text-muted hover:bg-sunken hover:text-ink pointer-fine:m-0 pointer-fine:h-auto pointer-fine:w-auto pointer-fine:p-0.5"
            >
              {open ? <Minus className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          </div>
        ) : (
          // Der ganze Griff ist der Schalter — auf dem Handy ist ein 18-px-Knopf
          // keine Bedienung.
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? 'Menü schließen' : 'Menü öffnen'}
            className="flex w-full flex-col items-center gap-1.5 rounded-t-2xl px-4 pb-2 pt-2"
          >
            <span className="h-1 w-10 rounded-full bg-edge" aria-hidden />
            <span className="flex w-full items-center justify-between">
              <span className="text-sm font-medium text-ink">{layoutLabel}</span>
              <span className="flex items-center gap-2 text-xs text-muted">
                {nodeCount.toLocaleString('de-DE')} Knoten
                <ChevronDown
                  className={cn('h-4 w-4 transition-transform', open && 'rotate-180')}
                />
              </span>
            </span>
          </button>
        )}

        {open && (
          <div
            className={cn(
              'flex flex-col overflow-y-auto px-3',
              // Unten Platz fuer die Home-Leiste des Geraets.
              'max-h-[62vh] gap-4 pb-[max(1rem,env(safe-area-inset-bottom))]',
              'md:max-h-[calc(100vh-9rem)] md:gap-3 md:pb-3',
            )}
          >
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted pointer-fine:left-2 pointer-fine:h-3.5 pointer-fine:w-3.5" />
            <input
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onSubmitQuery()}
              placeholder={`${nodeCount} Knoten durchsuchen …`}
              className={cn(
                'w-full rounded-lg border border-edge bg-sunken pl-8 pr-2 text-sm text-ink',
                'min-h-11 pointer-fine:min-h-0 pointer-fine:py-1.5 pointer-fine:pl-7 pointer-fine:text-[11px]',
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
                    className="flex min-h-11 w-full items-center gap-2 rounded px-1.5 text-left text-xs text-muted hover:bg-sunken hover:text-ink pointer-fine:min-h-0 pointer-fine:gap-1.5 pointer-fine:px-1 pointer-fine:py-0.5 pointer-fine:text-[11px]"
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
                className="min-h-11 rounded border border-edge bg-surface px-2 text-xs text-ink focus:outline-none pointer-fine:min-h-0 pointer-fine:px-1.5 pointer-fine:py-0.5 pointer-fine:text-[11px]"
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
                className="min-h-11 rounded border border-edge bg-surface px-2 text-xs text-ink focus:outline-none pointer-fine:min-h-0 pointer-fine:px-1.5 pointer-fine:py-0.5 pointer-fine:text-[11px]"
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
    </>
  )
}
