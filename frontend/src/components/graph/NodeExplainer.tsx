import type { SceneNode } from './scene'

/**
 * Kurzerklärung zu einem Datenpunkt.
 *
 * Bewusst aus dem, was ohnehin am Knoten steht — kein Modellaufruf beim Öffnen.
 * Der Graph hat 13.000 Knoten; eine erzeugte Erklärung je Klick verbrennt Budget
 * für einen Satz, den die Daten schon hergeben. Wer mehr wissen will, fragt
 * darunter im Chat nach.
 */
const KIND_TEXT: Record<string, string> = {
  paper: 'Eine Forschungsarbeit. Aus ihrem Abstract hat das System die verbundenen Begriffe gelesen.',
  concept: 'Ein Begriff oder Verfahren aus der KI-Forschung, gefunden in den Abstracts des Korpus.',
  model: 'Ein benanntes Modell oder eine Architektur.',
  dataset: 'Ein Datensatz oder Benchmark, auf dem Arbeiten gemessen werden.',
  task: 'Eine Aufgabenstellung, auf die Arbeiten, Modelle und Datensätze einzahlen.',
  repo: 'Eine Code-Veröffentlichung zu einer Arbeit.',
  system: 'Ein Baustein dieses Systems selbst — kein Fund aus der Literatur.',
  project: 'Ein Arbeitsbereich, der Chats und Dokumente bündelt.',
  service: 'Ein Dienst, den dieses System benutzt.',
}

function dateText(iso: string | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('de-DE')
}

export default function NodeExplainer({ node }: { node: SceneNode }) {
  const meta = node.meta as {
    source_document_ids?: string[]
    independent_sources?: number
    citations?: { citations?: number }
    provenance?: { source?: string }
  }
  const facts: string[] = []

  const belege = meta.independent_sources ?? meta.source_document_ids?.length
  if (belege) facts.push(`${belege} ${belege === 1 ? 'Beleg' : 'Belege'}`)

  const zitate = meta.citations?.citations
  if (typeof zitate === 'number') facts.push(`${zitate.toLocaleString('de-DE')} Zitationen`)

  const seit = dateText(node.first_seen)
  if (seit) facts.push(`im Graphen seit ${seit}`)

  if (node.status === 'pending') {
    facts.push('noch ungeprüft')
  }

  return (
    <div className="mb-4 rounded-lg bg-sunken px-3 py-2.5">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
        Kurzerklärung
      </div>
      <p className="text-sm text-ink">
        {KIND_TEXT[node.kind] ?? 'Ein Datenpunkt dieses Wissensgraphen.'}
      </p>
      {facts.length > 0 && <p className="mt-1 text-xs text-muted">{facts.join(' · ')}</p>}
    </div>
  )
}
