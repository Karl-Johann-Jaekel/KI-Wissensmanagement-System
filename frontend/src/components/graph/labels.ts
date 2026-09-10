/**
 * Wo die Cluster-Namen hingehören — und wie sie einander ausweichen.
 *
 * Die Namen saßen bisher über dem obersten Knoten ihrer Gruppe. In der Wolke
 * geht das auf: Gruppen liegen nebeneinander, ihre Oberkanten sind verschieden.
 * Auf dem Globus nicht — dort belegt jede Gruppe einen Längengrad-Sektor und
 * reicht von Pol zu Pol. Die Oberkante ist für *alle* Gruppen der Nordpol, also
 * landeten acht Namen auf demselben Punkt und ergaben einen unlesbaren Klumpen.
 *
 * Zwei Rechnungen lösen das, beide rein und deshalb prüfbar:
 *
 * * `globeLabelAnchors` setzt den Namen dorthin, wo die Gruppe gerade *vorn*
 *   steht — die Kugel dreht sich, der Name wandert mit.
 * * `spreadLabels` schiebt auseinander, was sich trotzdem noch überlappt.
 */

export interface LabelBox {
  key: string
  x: number
  y: number
  /** Breite des gesetzten Textes; nur waagerecht Überlappendes weicht aus. */
  width: number
}

/**
 * Senkrecht auseinanderschieben, was sich sonst überdeckt.
 *
 * Von oben nach unten: Jeder Name rutscht so weit nach unten, dass er unter
 * allen bereits gesetzten liegt, deren Textkasten ihn waagerecht schneidet.
 * Namen, die sich ohnehin nicht ins Gehege kommen, bleiben, wo sie sind.
 */
export function spreadLabels<T extends LabelBox>(items: readonly T[], lineHeight: number): T[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.key.localeCompare(b.key))
  const placed: T[] = []
  for (const item of sorted) {
    let y = item.y
    // Mehrfach prüfen: Weicht einer aus, kann er dem nächsten in die Quere kommen.
    for (let pass = 0; pass < sorted.length; pass += 1) {
      let moved = false
      for (const other of placed) {
        const apart = (item.width + other.width) / 2
        if (Math.abs(item.x - other.x) >= apart) continue
        if (Math.abs(y - other.y) >= lineHeight) continue
        y = other.y + lineHeight
        moved = true
      }
      if (!moved) break
    }
    placed.push({ ...item, y })
  }
  return placed
}

export interface DepthNode {
  group: string
  x?: number
  y?: number
  /** 1 = vorn beim Betrachter, 0 = auf der Rückseite (`globeFrame`). */
  depth?: number
  synthetic?: boolean
}

export interface Anchor {
  x: number
  y: number
  /** Mittlere Tiefe der beitragenden Knoten — 1 heißt: steht voll vorn. */
  depth: number
}

/** Ab dieser Tiefe gilt eine Gruppe als „steht vorn“ (siehe unten). */
export const GLOBE_FRONT_MIN = 0.62

/**
 * Ankerpunkt je Gruppe auf der Kugel: der Schwerpunkt ihrer *vorderen* Knoten.
 *
 * Gewichtet mit `depth - minDepth`, damit der Name dem sichtbaren Teil der
 * Gruppe folgt statt zwischen Vorder- und Rückseite zu mitteln — sonst zöge er
 * zur Kugelmitte, wo er über allem anderen läge. Gruppen, die gerade hinten
 * stehen, kommen nicht vor; ihr Name wäre eine Behauptung über etwas, das man
 * nicht sieht.
 *
 * Die Schwelle entscheidet zugleich, wie voll es vorn wird: Bei 0,55 drängelten
 * sich am Rand der Kugel vier Namen, weil schmale Sektoren dort dicht
 * beieinander liegen. Höher heißt weniger gleichzeitig — der Rest dreht sich
 * heran.
 */
export function globeLabelAnchors(
  nodes: readonly DepthNode[],
  minDepth = GLOBE_FRONT_MIN,
): Map<string, Anchor> {
  const sums = new Map<string, { x: number; y: number; w: number; d: number; n: number }>()
  for (const node of nodes) {
    if (node.synthetic) continue
    const depth = node.depth ?? 1
    const weight = depth - minDepth
    if (weight <= 0) continue
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) continue
    const acc = sums.get(node.group) ?? { x: 0, y: 0, w: 0, d: 0, n: 0 }
    acc.x += (node.x as number) * weight
    acc.y += (node.y as number) * weight
    acc.w += weight
    acc.d += depth
    acc.n += 1
    sums.set(node.group, acc)
  }

  const out = new Map<string, Anchor>()
  for (const [group, acc] of sums) {
    if (acc.w <= 0) continue
    out.set(group, { x: acc.x / acc.w, y: acc.y / acc.w, depth: acc.d / acc.n })
  }
  return out
}
