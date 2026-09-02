import { useMemo } from 'react'
import { describeRelations, NAMES_PER_GROUP, relationCount } from './relations'
import type { SceneLink, SceneNode } from './scene'

/**
 * Kurzerklärung zu einem Datenpunkt — was er ist, wie gut er belegt ist und
 * woran er hängt.
 *
 * Bewusst aus dem, was ohnehin in der Szene steht: kein Modellaufruf beim
 * Öffnen. Bei 13.000 Knoten verbrennt eine erzeugte Erklärung je Klick Budget
 * für eine Auskunft, die die Daten schon hergeben. Wer mehr will, fragt darunter
 * im Chat nach.
 *
 * Die Beziehungen sind der eigentliche Inhalt: dass "Self-Attention" ein Konzept
 * ist, sagt wenig — dass es von "Attention Is All You Need" eingeführt wurde,
 * ist die Auskunft.
 */
const KIND_TEXT: Record<string, string> = {
  paper: 'Forschungsarbeit. Die verbundenen Begriffe stammen aus ihrem Abstract.',
  concept: 'Begriff oder Verfahren aus der KI-Forschung, gefunden in den Abstracts des Korpus.',
  model: 'Benanntes Modell oder eine Architektur.',
  dataset: 'Datensatz oder Benchmark, auf dem Arbeiten gemessen werden.',
  task: 'Aufgabenstellung, auf die Arbeiten, Modelle und Datensätze einzahlen.',
  repo: 'Code-Veröffentlichung zu einer Arbeit.',
  system: 'Baustein dieses Systems selbst — kein Fund aus der Literatur.',
  project: 'Arbeitsbereich, der Chats und Dokumente bündelt.',
  service: 'Dienst, den dieses System benutzt.',
}

function jahr(node: SceneNode): string | null {
  const meta = node.meta as { date?: string; arxiv?: string; arxiv_id?: string }
  const arxiv = meta.arxiv ?? meta.arxiv_id
  // arXiv-Ids beginnen mit JJMM — daraus lässt sich das Jahr ablesen.
  if (arxiv && /^\d{4}\./.test(arxiv)) {
    const jj = Number(arxiv.slice(0, 2))
    return String(jj > 90 ? 1900 + jj : 2000 + jj)
  }
  const jahr = meta.date?.slice(0, 4)
  return jahr && /^\d{4}$/.test(jahr) ? jahr : null
}

interface Props {
  node: SceneNode
  links: SceneLink[]
  nodesById: Map<string, SceneNode>
  onSelectNode: (node: SceneNode) => void
}

export default function NodeExplainer({ node, links, nodesById, onSelectNode }: Props) {
  const groups = useMemo(
    () => describeRelations(node.id, links, nodesById),
    [node.id, links, nodesById],
  )

  const meta = node.meta as {
    source_document_ids?: string[]
    independent_sources?: number
    citations?: { citations?: number }
  }
  const zitate = (node as { citations?: number | null }).citations ?? meta.citations?.citations
  const landmark = (node as { landmark?: boolean }).landmark

  const facts: string[] = []
  const j = jahr(node)
  if (j) facts.push(j)
  const belege = meta.independent_sources ?? meta.source_document_ids?.length
  if (belege) facts.push(`${belege} ${belege === 1 ? 'Beleg' : 'Belege'}`)
  if (typeof zitate === 'number') {
    facts.push(`${zitate.toLocaleString('de-DE')} Zitationen${landmark ? ' · vielzitiert' : ''}`)
  }
  const verbindungen = relationCount(groups)
  if (verbindungen) facts.push(`${verbindungen} Verbindungen`)
  if (node.status === 'pending') facts.push('noch ungeprüft')

  return (
    <div className="mb-4 rounded-lg bg-sunken px-3 py-2.5">
      <p className="text-sm text-ink">
        {KIND_TEXT[node.kind] ?? 'Ein Datenpunkt dieses Wissensgraphen.'}
      </p>
      {facts.length > 0 && <p className="mt-1 text-xs text-muted">{facts.join(' · ')}</p>}

      {groups.length > 0 && (
        <dl className="mt-2.5 flex flex-col gap-1 border-t border-edge pt-2">
          {groups.map((group) => {
            const gezeigt = group.nodes.slice(0, NAMES_PER_GROUP)
            const rest = group.nodes.length - gezeigt.length
            return (
              <div key={group.label} className="flex gap-2 text-xs leading-relaxed">
                <dt className="w-32 shrink-0 text-muted">{group.label}</dt>
                <dd className="min-w-0 flex-1 text-ink">
                  {gezeigt.map((other, i) => (
                    <span key={other.id}>
                      {i > 0 && <span className="text-muted"> · </span>}
                      <button
                        type="button"
                        onClick={() => onSelectNode(other)}
                        className="text-left underline-offset-2 hover:underline"
                      >
                        {other.name}
                      </button>
                    </span>
                  ))}
                  {rest > 0 && <span className="text-muted"> · +{rest}</span>}
                </dd>
              </div>
            )
          })}
        </dl>
      )}
    </div>
  )
}
