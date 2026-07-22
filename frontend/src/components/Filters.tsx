import { KIND_COLORS, type GraphData, type NodeKind, type Scope } from '../types'

interface Props {
  scope: Scope
  onScope: (s: Scope) => void
  data: GraphData
  filterTech: string | null
  onFilterTech: (tech: string | null) => void
}

export default function Filters({ scope, onScope, data, filterTech, onFilterTech }: Props) {
  const techNames = Array.from(
    new Set(data.nodes.filter((n) => n.kind === 'technology').map((n) => n.name)),
  ).sort((a, b) => a.localeCompare(b))

  const kindsPresent = Array.from(new Set(data.nodes.map((n) => n.kind))) as NodeKind[]

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex overflow-hidden rounded-md border border-slate-700">
        {(['portfolio', 'knowledge'] as Scope[]).map((s) => (
          <button
            key={s}
            onClick={() => onScope(s)}
            className={
              'px-3 py-1.5 text-sm ' +
              (scope === s ? 'bg-sky-600 text-white' : 'bg-slate-900 text-slate-300 hover:bg-slate-800')
            }
          >
            {s === 'portfolio' ? 'Portfolio' : 'Wissen'}
          </button>
        ))}
      </div>

      <select
        value={filterTech ?? ''}
        onChange={(e) => onFilterTech(e.target.value || null)}
        className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200"
      >
        <option value="">Filter: Technologie …</option>
        {techNames.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>

      {filterTech && (
        <button
          onClick={() => onFilterTech(null)}
          className="rounded-md border border-slate-700 px-2 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
        >
          Filter zurücksetzen ✕
        </button>
      )}

      <div className="ml-auto flex flex-wrap gap-3 text-xs text-slate-400">
        {kindsPresent.map((k) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: KIND_COLORS[k] }}
            />
            {k}
          </span>
        ))}
      </div>
    </div>
  )
}
