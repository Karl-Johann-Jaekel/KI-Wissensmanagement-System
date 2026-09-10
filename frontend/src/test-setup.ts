/**
 * Was jsdom fehlt, aber der Browser mitbringt.
 *
 * `ResizeObserver` gibt es in jsdom nicht. Komponenten, die ihre Fläche messen
 * — die Wabenansicht entscheidet daran zwischen quer und hochkant —, stürzen
 * sonst im Test ab, obwohl im Browser nichts falsch ist. Der Ersatz misst nicht,
 * er hält nur still: Die Größenlogik selbst prüfen die reinen Tests.
 */
class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = NoopResizeObserver
}
