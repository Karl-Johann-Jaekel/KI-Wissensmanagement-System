/**
 * Unbekannte Adresse.
 *
 * Vorher sprang die Anwendung bei jedem unbekannten Pfad still nach `/chat` —
 * ein vertippter oder veralteter Link landete wortlos in einer anderen Ansicht,
 * und der Besucher konnte nicht wissen, ob er falsch geklickt hatte oder die
 * Seite verschwunden ist. Der Weg weiter steht hier ausdrücklich.
 */
import { Link, useLocation } from 'react-router-dom'
import { Compass } from 'lucide-react'

const ZIELE = [
  { to: '/inbox', label: 'Zur Übersicht' },
  { to: '/wissen', label: 'Wissensbasis' },
  { to: '/suche', label: 'Suche' },
  { to: '/chat', label: 'Chat' },
]

export default function NotFoundPage() {
  const { pathname } = useLocation()

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-6">
      <div className="max-w-md text-center">
        <Compass className="mx-auto h-8 w-8 text-primary-400" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-semibold">Diese Seite gibt es nicht</h1>
        <p className="mt-1.5 break-words text-sm leading-relaxed text-muted">
          Unter <code className="rounded bg-sunken px-1 py-0.5 font-mono text-xs">{pathname}</code>{' '}
          liegt nichts. Vielleicht hilft einer dieser Wege.
        </p>
        <nav className="mt-4 flex flex-wrap justify-center gap-2" aria-label="Weiter zu">
          {ZIELE.map((z) => (
            <Link
              key={z.to}
              to={z.to}
              className="inline-flex min-h-11 items-center rounded-lg border border-edge bg-surface px-3 text-sm transition-colors hover:border-primary-500/50 pointer-fine:min-h-0 pointer-fine:py-2"
            >
              {z.label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  )
}
