/**
 * Inbox: Einstiegserklärung plus Änderungen der letzten Woche.
 *
 * Vorher stand hier die Review-Queue für pending-Fakten. Die hing am
 * Admin-Modus, den es nicht mehr gibt — übrig geblieben wäre eine Seite, die
 * nur mitteilt, dass hier nichts zu sehen ist. Stattdessen erklärt sie jetzt,
 * was die Anwendung tut und wie die Teile zusammenhängen.
 */
import { Link } from 'react-router-dom'
import { BookOpen, MessageSquare, Search, ShieldCheck, Sparkles, Workflow } from 'lucide-react'
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
    text: 'Aus den Papers extrahierte Aussagen gelten zunächst als offen. In den Graphen wandern sie erst, wenn zwei unabhängige Quellen sie stützen.',
  },
  {
    icon: Sparkles,
    titel: 'Der Bestand wächst weiter',
    text: 'Ein wiederkehrender Lauf holt neue Veröffentlichungen, zerlegt sie, bettet sie ein und verknüpft sie. Was zuletzt dazugekommen ist, steht unten.',
  },
]

export default function InboxPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4 lg:p-6">
        <header>
          <h1 className="text-lg font-semibold">Wie das hier funktioniert</h1>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Ein Frage-Antwort-System über KI-Forschungsliteratur, das jede Aussage mit ihrer
            Quelle belegt. Im Bestand liegen{' '}
            <strong className="font-medium text-ink">56 Papers</strong> als{' '}
            <strong className="font-medium text-ink">6.950 Textabschnitte</strong>, daraus ein
            Graph aus <strong className="font-medium text-ink">13.271 Knoten</strong>.
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
