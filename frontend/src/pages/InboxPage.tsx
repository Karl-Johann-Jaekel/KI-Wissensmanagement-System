/**
 * Inbox: Einstiegserklärung plus Änderungen der letzten Woche.
 *
 * Vorher stand hier die Review-Queue für pending-Fakten. Die hing am
 * Admin-Modus, den es nicht mehr gibt — übrig geblieben wäre eine Seite, die
 * nur mitteilt, dass hier nichts zu sehen ist. Stattdessen erklärt sie jetzt,
 * was die Anwendung tut und wie die Teile zusammenhängen.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, MessageSquare, Search, ShieldCheck, Sparkles, Workflow } from 'lucide-react'
import { fetchStats, type CorpusStats } from '../api'
import ChangelogFeed from '../components/inbox/ChangelogFeed'
import Card from '../components/ui/Card'

const BEREICHE = [
  {
    icon: BookOpen,
    titel: 'Wissen',
    text: 'Der Graph zeigt den Bestand als Karte: Papers, Code, Aufgaben, Datensätze, Modelle und Konzepte, verbunden über das, was sie teilen. Unter „Dokumente" liegt dieselbe Menge als Liste.',
    to: '/wissen',
  },
  {
    icon: Search,
    titel: 'Suche',
    text: 'Hybrid aus Vektor- und Volltextsuche. Beide Ranglisten werden zu einer verschmolzen — Treffer, die nur eines von beidem findet, gehen dadurch nicht verloren.',
    to: '/suche',
  },
  {
    icon: MessageSquare,
    titel: 'Chat',
    text: 'Fragen in ganzen Sätzen. Die Antwort entsteht ausschließlich aus den gefundenen Textstellen, und jede Aussage nennt Paper und Abschnitt, aus dem sie stammt.',
    to: '/chat',
  },
]

const GRUNDSAETZE = [
  {
    icon: ShieldCheck,
    titel: 'Belegpflicht statt Bauchgefühl',
    text: 'Das Sprachmodell bekommt nur die abgerufenen Passagen und die Anweisung, nichts darüber hinaus zu behaupten. Findet die Suche nichts, sagt die Antwort das — statt etwas zu erfinden.',
  },
  {
    icon: Workflow,
    titel: 'Fakten müssen sich bewähren',
    // Die Zahl der geforderten Quellen ist eine Einstellung (PROMOTE_MIN_SOURCES)
    // und stand hier als „zwei" — gemessen läuft die Instanz auf einer. Der Satz
    // nennt jetzt die Regel statt eines Wertes, den er nicht kennt.
    text: 'Aus den Papers extrahierte Aussagen gelten zunächst als offen. In den Graphen wandern sie erst, wenn Belegzahl und Konfidenz die eingestellte Schwelle erreichen — regelbasiert, mit Herkunft an jedem Fakt.',
  },
  {
    icon: Sparkles,
    titel: 'Der Bestand wächst weiter',
    text: 'Ein wiederkehrender Lauf holt neue Veröffentlichungen, zerlegt sie, bettet sie ein und verknüpft sie. Was zuletzt dazugekommen ist, steht unten.',
  },
]

/** Zahl im Fließtext — hervorgehoben, aber im Satz stehend. */
function Zahl({ children }: { children: React.ReactNode }) {
  return <strong className="font-medium text-ink">{children}</strong>
}

/**
 * Bestandssatz aus den gemessenen Zahlen.
 *
 * Solange sie unterwegs sind, steht der Satz ohne sie da — eine Zahl, die
 * gleich durch eine andere ersetzt wird, ist schlimmer als keine. Fällt der
 * Abruf aus, bleibt es dabei; der Rest der Seite stimmt weiterhin.
 */
function Bestand({ stats }: { stats: CorpusStats | null }) {
  if (!stats) {
    return (
      <>Ein Frage-Antwort-System über KI-Forschungsliteratur, das jede Aussage mit ihrer Quelle
      belegt.</>
    )
  }
  const n = (value: number) => value.toLocaleString('de-DE')
  return (
    <>
      Ein Frage-Antwort-System über KI-Forschungsliteratur, das jede Aussage mit ihrer Quelle
      belegt. Im Bestand liegen <Zahl>{n(stats.documents)} Papers</Zahl> als{' '}
      <Zahl>{n(stats.chunks)} Textabschnitte</Zahl>, daraus ein Graph aus{' '}
      <Zahl>{n(stats.nodes)} Knoten</Zahl>.
    </>
  )
}

export default function InboxPage() {
  const [stats, setStats] = useState<CorpusStats | null>(null)

  useEffect(() => {
    let aktuell = true
    // Ohne Zahlen ist die Seite unvollständig, nicht kaputt: ein Fehlschlag
    // bleibt still, statt eine rote Zeile über die Erklärung zu legen.
    fetchStats()
      .then((s) => aktuell && setStats(s))
      .catch(() => {})
    return () => {
      aktuell = false
    }
  }, [])

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4 lg:p-6">
        <header>
          <h1 className="text-lg font-semibold">Wie das hier funktioniert</h1>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            <Bestand stats={stats} />
          </p>
        </header>

        <div className="grid gap-3 sm:grid-cols-3">
          {BEREICHE.map(({ icon: Icon, titel, text, to }) => (
            <Link
              key={titel}
              to={to}
              className="rounded-xl border border-edge bg-surface p-4 transition-colors hover:border-primary-500/50"
            >
              <h2 className="mb-1.5 flex items-center gap-2 text-sm font-semibold">
                <Icon className="h-4 w-4 text-primary-400" />
                {titel}
              </h2>
              <p className="text-xs leading-relaxed text-muted">{text}</p>
            </Link>
          ))}
        </div>

        <Card>
          <h2 className="mb-3 text-sm font-semibold">Worauf es dabei ankommt</h2>
          <ul className="flex flex-col gap-3">
            {GRUNDSAETZE.map(({ icon: Icon, titel, text }) => (
              <li key={titel} className="flex gap-3">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary-400" />
                <div>
                  <p className="text-sm font-medium">{titel}</p>
                  <p className="text-xs leading-relaxed text-muted">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-primary-400" />
            Neu (7 Tage)
          </h2>
          <ChangelogFeed days={7} />
        </Card>
      </div>
    </div>
  )
}
