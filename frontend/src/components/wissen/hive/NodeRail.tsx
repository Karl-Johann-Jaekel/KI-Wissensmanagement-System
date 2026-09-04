/**
 * Rechte Spalte: Details zum angeklickten Knoten.
 *
 * Bewusst schlank gehalten — die Wabenansicht ordnet ein, sie liest nicht. Wer
 * den Volltext will, geht über „Dokument öffnen" in die Leseansicht; wer die
 * Nachbarschaft abwandern will, klickt sich hier weiter und landet irgendwann im
 * Graph-Explorer.
 */
import { ArrowUpRight, FileText, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '../../../lib/cn'
import { safeHref } from '../../../lib/safeHref'
import Badge from '../../ui/Badge'
import { nodeMeta, relationsOf, type Hive, type HiveNode, type Sector } from './hive'

interface Props {
  node: HiveNode
  sector: Sector | undefined
  hive: Hive
  onPickNode: (node: HiveNode) => void
  onClose: () => void
  className?: string
}

/** Gegenüber je Beziehungsgruppe, bevor nur noch gezählt wird. */
const NAMES_PER_GROUP = 5

export default function NodeRail({ node, sector, hive, onPickNode, onClose, className }: Props) {
  const meta = nodeMeta(node)
  const arxivId = meta.arxiv ?? meta.arxiv_id
  const href = safeHref(
    meta.uri ?? meta.url ?? (arxivId ? `https://arxiv.org/abs/${arxivId}` : null),
  )
  const docId = meta.source_document_ids?.[0]
  const groups = relationsOf(node.id, hive.links, hive.nodesById)
  const color = sector?.color ?? '#2dd4bf'
  const prov = meta.provenance

  return (
    <aside
      aria-label={`Details zum Knoten ${node.name}`}
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-xl border border-edge bg-surface',
        className,
      )}
    >
      <div
        className="flex items-start gap-2 border-b border-edge px-3.5 py-3"
        style={{ background: `linear-gradient(90deg, ${color}1a 0%, transparent 70%)` }}
      >
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-[0.14em] text-muted">
            Details zum Knoten
          </div>
          <h3 className="mt-0.5 break-words text-sm font-semibold text-ink">{node.name}</h3>
        </div>
        <button
          onClick={onClose}
          aria-label="Details schließen"
          className="rounded-lg p-1 text-muted transition-colors hover:bg-sunken hover:text-ink"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3.5 py-3">
        <div className="flex flex-wrap gap-1.5">
          <Badge
            style={{ borderColor: `${color}66`, color }}
            className="border bg-transparent"
          >
            {sector?.label ?? node.kind}
          </Badge>
          <Badge tone={node.status === 'verified' ? 'green' : 'amber'}>{node.status}</Badge>
          {node.landmark && <Badge tone="amber">Landmark</Badge>}
          {meta.is_official && <Badge tone="sky">offiziell</Badge>}
        </div>

        <dl className="space-y-1.5 text-[11px]">
          <Row label="Herkunft" value={node.source} />
          {node.year !== null && <Row label="Veröffentlicht" value={String(node.year)} />}
          <Row
            label="Vernetzung"
            value={Math.round(node.val).toLocaleString('de-DE')}
            hint="Kantengewicht über den ganzen Graphen, vom Server vor der Kappung gezählt"
          />
          <Row
            label="Kanten hier"
            value={node.degree.toLocaleString('de-DE')}
            hint="Kanten in der ausgelieferten Antwort — durch die Kappung weniger als im Bestand"
          />
          {typeof node.citations === 'number' && (
            <Row label="Zitationen" value={node.citations.toLocaleString('de-DE')} />
          )}
          {meta.framework && meta.framework !== 'none' && (
            <Row label="Framework" value={meta.framework} />
          )}
          {!node.id.startsWith('svc:') && (
            <Row
              label="Im Bestand seit"
              value={new Date(node.first_seen).toLocaleDateString('de-DE')}
            />
          )}
          {prov?.license && <Row label="Lizenz" value={prov.license} />}
        </dl>

        {(meta.note ?? meta.abstract) && (
          <p className="text-[11px] leading-relaxed text-muted">
            {(meta.note ?? meta.abstract ?? '').slice(0, 420)}
            {(meta.abstract ?? '').length > 420 && ' …'}
          </p>
        )}

        {groups.length > 0 && (
          <div>
            <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
              Beziehungen
            </h4>
            <ul className="space-y-2">
              {groups.slice(0, 6).map((group) => (
                <li key={group.label}>
                  <div className="text-[10px] uppercase tracking-wider text-muted">
                    {group.label}
                  </div>
                  <ul className="mt-0.5 space-y-0.5">
                    {group.nodes.slice(0, NAMES_PER_GROUP).map((other) => (
                      <li key={other.id}>
                        <button
                          onClick={() => onPickNode(other)}
                          className="w-full truncate rounded px-1 py-0.5 text-left text-[11px] text-ink transition-colors hover:bg-sunken"
                          title={other.name}
                        >
                          {other.name}
                        </button>
                      </li>
                    ))}
                    {group.nodes.length > NAMES_PER_GROUP && (
                      <li className="px-1 text-[10px] text-muted">
                        … und {group.nodes.length - NAMES_PER_GROUP} weitere
                      </li>
                    )}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-col gap-1.5 pt-1">
          {docId && (
            <Link
              to={`/wissen/doc/${docId}`}
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-primary-400 hover:underline"
            >
              <FileText className="h-3.5 w-3.5" />
              Dokument öffnen
            </Link>
          )}
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 truncate text-[11px] font-medium text-primary-400 hover:underline"
            >
              <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
              Quelle aufrufen
            </a>
          )}
        </div>
      </div>
    </aside>
  )
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2" title={hint}>
      <dt className="w-24 shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-ink">{value}</dd>
    </div>
  )
}
