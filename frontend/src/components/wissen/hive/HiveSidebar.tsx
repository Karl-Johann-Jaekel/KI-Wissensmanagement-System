/**
 * Linke Spalte der Wabenansicht: Ansicht, Legende, Filter.
 *
 * Die Filter greifen bewusst an zwei verschiedenen Stellen an. „Quelle" fragt
 * den Server neu (`/graph?source=`), die übrigen rechnen auf der bereits
 * geladenen Antwort — ein Wechsel der Mindestvernetzung soll keine Runde übers
 * Netz kosten.
 */
import { Clock, Hexagon, Network } from 'lucide-react'
import { cn } from '../../../lib/cn'
import { GRAPH_SOURCES, type GraphSource } from '../../../types'
import Select from '../../ui/Select'
import type { HiveFilter, Sector } from './hive'

export type HiveMode = 'comb' | 'time'

interface Props {
  mode: HiveMode
  onMode: (mode: HiveMode) => void
  sectors: Sector[]
  focus: string | null
  onFocus: (sectorId: string | null) => void
  onHover: (sectorId: string | null) => void
  source: GraphSource
  onSource: (source: GraphSource) => void
  filter: HiveFilter
  onFilter: (patch: Partial<HiveFilter>) => void
  /** Wechselt in den Graph-Explorer. */
  onOpenGraph: () => void
}

const DEGREE_STEPS = [
  { value: 0, label: 'alle Knoten' },
  { value: 2, label: 'ab 2 Verbindungen' },
  { value: 5, label: 'ab 5 Verbindungen' },
  { value: 10, label: 'ab 10 Verbindungen' },
  { value: 25, label: 'ab 25 Verbindungen' },
]

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
        {title}
      </h3>
      {children}
    </section>
  )
}

export default function HiveSidebar({
  mode,
  onMode,
  sectors,
  focus,
  onFocus,
  onHover,
  source,
  onSource,
  filter,
  onFilter,
  onOpenGraph,
}: Props) {
  const views: { id: HiveMode; label: string; icon: typeof Hexagon }[] = [
    { id: 'comb', label: 'Wabenstruktur', icon: Hexagon },
    { id: 'time', label: 'Zeitleiste', icon: Clock },
  ]

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto border-r border-edge bg-surface px-4 py-4">
      <Group title="Ansicht">
        <ul className="space-y-0.5">
          {views.map((v) => (
            <li key={v.id}>
              <button
                onClick={() => onMode(v.id)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors',
                  mode === v.id
                    ? 'bg-primary-950/60 font-medium text-primary-300'
                    : 'text-muted hover:bg-sunken hover:text-ink',
                )}
              >
                <v.icon className="h-3.5 w-3.5 shrink-0" />
                {v.label}
              </button>
            </li>
          ))}
          <li>
            <button
              onClick={onOpenGraph}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-sunken hover:text-ink"
            >
              <Network className="h-3.5 w-3.5 shrink-0" />
              Netzwerk
              <span className="ml-auto text-[10px] text-muted">↗</span>
            </button>
          </li>
        </ul>
      </Group>

      <Group title="Legende">
        <ul className="space-y-1">
          {sectors.map((sector) => (
            <li key={sector.id}>
              <button
                onClick={() => onFocus(focus === sector.id ? null : sector.id)}
                onMouseEnter={() => onHover(sector.id)}
                onMouseLeave={() => onHover(null)}
                aria-pressed={focus === sector.id}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-[11px] transition-colors',
                  focus === sector.id ? 'bg-sunken' : 'hover:bg-sunken',
                )}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: sector.color }}
                />
                <span
                  className="min-w-0 flex-1 truncate text-left uppercase tracking-wider"
                  style={{ color: sector.color }}
                >
                  {sector.label}
                </span>
                <span className="shrink-0 tabular-nums text-muted">
                  {sector.count.toLocaleString('de-DE')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Group>

      <Group title="Filter">
        <div className="space-y-2">
          <label className="block">
            <span className="mb-1 block text-[10px] text-muted">Quelle</span>
            <Select
              value={source}
              onChange={(e) => onSource(e.target.value as GraphSource)}
              className="w-full py-1 text-xs"
            >
              {GRAPH_SOURCES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] text-muted">Vernetzung</span>
            <Select
              value={filter.minDegree}
              onChange={(e) => onFilter({ minDegree: Number(e.target.value) })}
              className="w-full py-1 text-xs"
            >
              {DEGREE_STEPS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] text-muted">Bereich</span>
            <Select
              value={focus ?? ''}
              onChange={(e) => onFocus(e.target.value || null)}
              className="w-full py-1 text-xs"
            >
              <option value="">alle Bereiche</option>
              {sectors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-2 pt-1 text-[11px] text-muted">
            <span>Nur vielzitierte</span>
            <span className="relative inline-flex">
              <input
                type="checkbox"
                checked={filter.landmarkOnly}
                onChange={(e) => onFilter({ landmarkOnly: e.target.checked })}
                className="peer sr-only"
              />
              <span className="h-4 w-7 rounded-full bg-sunken transition-colors peer-checked:bg-primary-500 peer-focus-visible:ring-2 peer-focus-visible:ring-primary-500/50" />
              <span className="absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-muted transition-transform peer-checked:translate-x-3 peer-checked:bg-white" />
            </span>
          </label>
          <p className="pt-1 text-[10px] leading-relaxed text-muted">
            „Vielzitiert" nutzt das Landmark-Kennzeichen aus den Zitationsdaten (ADR-0013).
          </p>
        </div>
      </Group>
    </div>
  )
}
