/**
 * Was eine Knotenart *ist*, in einem Satz.
 *
 * Steht hier statt in einer Komponente, weil zwei Ansichten dieselbe Auskunft
 * geben: die Leseansicht des Graph-Explorers und die Wabenansicht. Zwei Texte
 * für dieselbe Sache wären zwei Stellen, an denen einer veraltet.
 *
 * Bewusst ohne Modellaufruf: Bei 13.000 Knoten verbrennt eine erzeugte
 * Kurzerklärung je Klick Budget für eine Auskunft, die die Daten schon hergeben.
 * Wer mehr will, fragt im Chat am Knoten nach.
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

export function kindText(kind: string): string {
  return KIND_TEXT[kind] ?? 'Ein Datenpunkt dieses Wissensgraphen.'
}

/**
 * Trägt die Id einen Knoten aus `graph_nodes`?
 *
 * Kern, Projekte und Dienste sind in der Szene erfunden (`scene.ts`) und tragen
 * eigene Präfixe. Alles, was am Server nach einem Graph-Knoten fragt — der
 * Chat am Knoten etwa —, muss sie aussortieren, sonst fragt es nach einer Id,
 * die es in der Datenbank nicht gibt.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isGraphNodeId(id: string): boolean {
  return UUID.test(id)
}
