import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Kurzer Name des gekapselten Bereichs, erscheint in der Meldung. */
  area?: string
}

interface State {
  error: Error | null
}

/**
 * Fängt Render-Fehler eines Teilbaums ab.
 *
 * Vorher gab es keine einzige Boundary: ein Fehler im Graph-Canvas oder ein
 * fehlgeformtes `meta` aus den Fremddaten nahm die ganze Seite mit, und der
 * Besucher sah eine weiße Fläche ohne Hinweis.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`Fehler in ${this.props.area ?? 'der Ansicht'}:`, error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div role="alert" className="flex h-full items-center justify-center p-6">
        <div className="max-w-md rounded-xl border border-edge bg-surface p-5 text-sm">
          <h2 className="mb-1 font-semibold text-ink">
            {this.props.area ?? 'Diese Ansicht'} konnte nicht geladen werden
          </h2>
          <p className="mb-3 text-muted">
            Der Rest der Anwendung läuft weiter. Beim erneuten Versuch wird die Ansicht neu
            aufgebaut.
          </p>
          <p className="mb-3 break-words font-mono text-xs text-muted">{error.message}</p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="rounded-lg bg-primary-600 px-3 py-1.5 text-white hover:bg-primary-700"
          >
            Erneut versuchen
          </button>
        </div>
      </div>
    )
  }
}
