/**
 * Theme — fest auf dunkel.
 *
 * Die Anwendung läuft als öffentliche Demo und ist durchgehend dunkel gestaltet:
 * Der Graph-Canvas rechnet mit additivem Leuchten auf dunklem Grund, die
 * Cluster-Palette ist darauf abgestimmt. Eine helle Variante hätte beides
 * doppelt gebraucht.
 *
 * Der Typ bleibt bestehen, statt ihn überall zu entfernen: Canvas, Szene und
 * Minimap reichen ihn ohnehin durch, und mit genau einem zulässigen Wert lehnt
 * der Compiler jede künftige Verzweigung auf 'light' sofort ab.
 */

export type Theme = 'dark'

export const THEME: Theme = 'dark'

/** Setzt die `dark`-Klasse auf <html>; Tailwind hängt daran. */
export function applyTheme(): void {
  document.documentElement.classList.add('dark')
}

export function useTheme(): { theme: Theme } {
  return { theme: THEME }
}
