/**
 * Nur http/https als Ziel zulassen.
 *
 * Ein Teil der Knoten und Quellen stammt aus dem Papers-with-Code-Dump und aus
 * PDF-Metadaten — beides Fremddaten, die ungeprüft in `href` landeten. Ein
 * `javascript:`-URI darin führt beim Klick Code in der Seite aus. react-markdown
 * filtert das für Links *im Text* bereits; diese Links stehen aber im JSX
 * daneben und liefen an dem Schutz vorbei.
 *
 * Rückgabe `undefined` statt `'#'`: ein `<a>` ohne href ist kein Link mehr,
 * bekommt keinen Fokus und sieht nicht klickbar aus.
 */
export function safeHref(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined
  try {
    // Basis mitgeben, damit relative Angaben nicht als ungültig durchfallen.
    const url = new URL(raw, window.location.origin)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}
