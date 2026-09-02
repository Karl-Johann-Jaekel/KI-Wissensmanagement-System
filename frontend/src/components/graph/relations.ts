/**
 * Beziehungen eines Knotens in lesbare Gruppen fassen.
 *
 * Der Wert eines Wissensgraphen steckt in den Kanten, nicht in den Knoten: dass
 * "Self-Attention" ein Konzept ist, sagt wenig — dass es von "Attention Is All
 * You Need" eingeführt wurde und in zwölf weiteren Arbeiten auftaucht, ist die
 * Auskunft. Die Leseansicht zeigte davon bisher nichts.
 *
 * Die Richtung entscheidet über die Formulierung: dieselbe Kante heißt vom Paper
 * aus "führt ein" und vom Konzept aus "eingeführt von".
 */
import { endpoint, type SceneLink, type SceneNode } from './scene'

/** Label je Relation — [ausgehend, eingehend]. */
const RELATION_LABELS: Record<string, [string, string]> = {
  INTRODUCES: ['führt ein', 'eingeführt von'],
  EVALUATES_ON: ['evaluiert auf', 'Bewertungsgrundlage für'],
  IMPROVES_ON: ['verbessert', 'verbessert durch'],
  RELATED_TO: ['verwandt mit', 'verwandt mit'],
  USES: ['nutzt', 'genutzt von'],
  USES_DATASET: ['nutzt Datensatz', 'genutzt von'],
  IMPLEMENTS: ['implementiert', 'implementiert von'],
  ACHIEVES_SOTA: ['erreicht Bestwert auf', 'Bestwert erreicht von'],
  // Synthetische Kanten der Systemebene (scene.ts).
  nutzt: ['nutzt', 'genutzt von'],
  enthält: ['enthält', 'gehört zu'],
}

export interface RelationGroup {
  /** Formulierung aus Sicht des betrachteten Knotens. */
  label: string
  /** Gegenüber, nach Vernetzungsgrad absteigend. */
  nodes: SceneNode[]
}

/** Wie viele Gegenüber je Gruppe genannt werden, bevor gezählt wird. */
export const NAMES_PER_GROUP = 4

function labelFor(relation: string, outgoing: boolean): string {
  const pair = RELATION_LABELS[relation]
  if (pair) return pair[outgoing ? 0 : 1]
  // Unbekannte Relation: den Rohwert lesbar machen, statt sie zu verschweigen.
  return relation.toLowerCase().replace(/_/g, ' ')
}

/**
 * Beziehungen eines Knotens, gruppiert und sortiert.
 *
 * Gruppen mit den meisten Gegenübern zuerst; innerhalb einer Gruppe die
 * bestvernetzten Knoten zuerst, damit die aussagekräftigsten Namen sichtbar sind.
 */
export function describeRelations(
  nodeId: string,
  links: SceneLink[],
  nodesById: Map<string, SceneNode>,
): RelationGroup[] {
  const groups = new Map<string, SceneNode[]>()

  for (const link of links) {
    const source = endpoint(link.source)
    const target = endpoint(link.target)
    if (source !== nodeId && target !== nodeId) continue
    const outgoing = source === nodeId
    const other = nodesById.get(outgoing ? target : source)
    // Selbstbezug und Kanten ins Leere (gekappte Knotenmenge) übergehen.
    if (!other || other.id === nodeId) continue

    const label = labelFor(link.relation, outgoing)
    const list = groups.get(label)
    if (list) {
      if (!list.some((n) => n.id === other.id)) list.push(other)
    } else {
      groups.set(label, [other])
    }
  }

  return [...groups.entries()]
    .map(([label, nodes]) => ({
      label,
      nodes: [...nodes].sort((a, b) => b.val - a.val || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.nodes.length - a.nodes.length || a.label.localeCompare(b.label))
}

/** Gesamtzahl der Gegenüber über alle Gruppen. */
export function relationCount(groups: RelationGroup[]): number {
  return groups.reduce((sum, g) => sum + g.nodes.length, 0)
}
