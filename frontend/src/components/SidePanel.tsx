import { endpointId, type GraphData, type GraphNode } from '../types'

interface Props {
  node: GraphNode
  data: GraphData
  onClose: () => void
  onSelectTech: (tech: string) => void
  onAskAbout?: (repoName: string) => void
}

interface TechRef {
  name: string
  relation: string
  weight: number
}

export default function SidePanel({ node, data, onClose, onSelectTech, onAskAbout }: Props) {
  const byId = new Map(data.nodes.map((n) => [n.id, n]))
  const techs: TechRef[] = []
  for (const l of data.links) {
    const s = endpointId(l.source)
    const t = endpointId(l.target)
    if (s !== node.id) continue
    const other = byId.get(t)
    if (other && other.kind === 'technology') {
      techs.push({ name: other.name, relation: l.relation, weight: l.weight })
    }
  }
  techs.sort((a, b) => b.weight - a.weight)

  const meta = node.meta as {
    description?: string
    url?: string
    stars?: number
    archived?: boolean
  }

  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-l border-slate-800 bg-slate-900/80 p-4">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">{node.kind}</div>
          <h2 className="text-lg font-semibold text-slate-100">{node.name}</h2>
        </div>
        <button
          onClick={onClose}
          className="rounded px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          aria-label="Schließen"
        >
          ✕
        </button>
      </div>

      {meta.description && <p className="mb-3 text-sm text-slate-300">{meta.description}</p>}

      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        {typeof meta.stars === 'number' && (
          <span className="rounded bg-slate-800 px-2 py-1">★ {meta.stars}</span>
        )}
        {meta.archived && (
          <span className="rounded bg-amber-900/60 px-2 py-1 text-amber-200">archiviert</span>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {meta.url && (
          <a
            href={meta.url}
            target="_blank"
            rel="noreferrer"
            className="inline-block rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500"
          >
            Auf GitHub öffnen ↗
          </a>
        )}
        {onAskAbout && (
          <button
            onClick={() => onAskAbout(node.name)}
            className="inline-block rounded border border-sky-500/50 px-3 py-1.5 text-sm font-medium text-sky-300 hover:bg-sky-500/10"
          >
            Im Chat fragen 💬
          </button>
        )}
      </div>

      {techs.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-200">
            Tech-Stack ({techs.length})
          </h3>
          <ul className="flex flex-wrap gap-1.5">
            {techs.map((t) => (
              <li key={`${t.name}-${t.relation}`}>
                <button
                  onClick={() => onSelectTech(t.name)}
                  title={`${t.relation} · weight ${t.weight}`}
                  className="rounded-full border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 text-xs text-violet-200 hover:bg-violet-500/30"
                >
                  {t.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  )
}
