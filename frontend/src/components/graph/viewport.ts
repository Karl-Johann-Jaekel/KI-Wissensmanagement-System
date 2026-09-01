/**
 * Kamera-Einpassung gegen die *freie* Zeichenfläche.
 *
 * `zoomToFit` der Graph-Bibliothek kennt nur eine Polsterung ringsum und rechnet
 * gegen die volle Breite. Das Bedienmenü liegt aber als Überlagerung darauf: in
 * der Ebenenansicht verschwand die rechte Spalte (Konzepte) vollständig
 * dahinter, ohne dass am Graphen etwas falsch gewesen wäre.
 *
 * Hier steckt nur Rechnung, kein Canvas — dadurch prüfbar.
 */

export interface Bounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export interface Viewport {
  width: number
  height: number
  /** Von einer Überlagerung belegte Bildpunkte am rechten Rand. */
  insetRight?: number
  /** Luft zwischen Inhalt und Kante; deckt auch den Knotenradius ab. */
  padding?: number
}

export interface CameraTransform {
  /** Zoomfaktor. */
  k: number
  /** Weltkoordinate, die in der Mitte der Fläche liegen soll. */
  x: number
  y: number
}

/** Unterhalb wird nichts mehr erkannt, oberhalb sieht man nur noch einen Knoten. */
const K_MIN = 0.02
const K_MAX = 8

/** Umschließendes Rechteck aller platzierten Knoten. */
export function boundsOf(nodes: readonly { x?: number; y?: number }[]): Bounds | null {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const n of nodes) {
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) continue
    const x = n.x as number
    const y = n.y as number
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  // Vor dem ersten Simulationsschritt hat noch kein Knoten eine Position.
  if (minX === Infinity) return null
  return { minX, maxX, minY, maxY }
}

/**
 * Zoom und Mittelpunkt, damit der Inhalt vollständig **neben** der Überlagerung
 * liegt statt teilweise darunter.
 */
export function fitTransform(bounds: Bounds, viewport: Viewport): CameraTransform {
  const pad = viewport.padding ?? 40
  const inset = Math.max(0, viewport.insetRight ?? 0)

  // Ein einzelner Knoten hat die Ausdehnung null — ohne Untergrenze teilte die
  // Rechnung durch null und der Zoom liefe gegen unendlich.
  const w = Math.max(1, bounds.maxX - bounds.minX)
  const h = Math.max(1, bounds.maxY - bounds.minY)

  const availW = Math.max(60, viewport.width - inset - pad * 2)
  const availH = Math.max(60, viewport.height - pad * 2)
  const k = Math.min(K_MAX, Math.max(K_MIN, Math.min(availW / w, availH / h)))

  // Der freie Bereich endet `inset` Bildpunkte vor der rechten Kante, seine
  // Mitte liegt also um inset/2 links der Flächenmitte. Die Kamera zeigt immer
  // auf die Flächenmitte — sie muss deshalb um denselben Betrag nach rechts,
  // umgerechnet in Weltkoordinaten.
  return {
    k,
    x: (bounds.minX + bounds.maxX) / 2 + inset / 2 / k,
    y: (bounds.minY + bounds.maxY) / 2,
  }
}
