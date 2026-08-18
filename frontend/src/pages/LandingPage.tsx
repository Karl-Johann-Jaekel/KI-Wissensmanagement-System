import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Boxes,
  Brain,
  Code2,
  FileSearch,
  Moon,
  Network,
  Quote,
  RefreshCw,
  ShieldCheck,
  Sun,
} from 'lucide-react'
import { fetchDocuments, fetchGraph } from '../api'
import GlobePreview from '../components/graph/GlobePreview'
import Button from '../components/ui/Button'
import { cn } from '../lib/cn'
import { useTheme } from '../lib/theme'
import { KIND_COLORS, type GraphData, type NodeKind } from '../types'
import { useElementSize } from '../useElementSize'

const REPO_URL = 'https://github.com/Karl-Johann-Jaekel/KI-Wissensmanagement-System'
const EMPTY: GraphData = { nodes: [], links: [] }

interface Stats {
  papers: number
  chunks: number
  nodes: number
  edges: number
}

const FEATURES = [
  {
    icon: Quote,
    title: 'Antworten mit Belegstelle',
    text: 'Jede Antwort nennt Paper und Abschnitt, aus dem sie stammt. Fehlt eine belastbare Quelle, sagt das System das — statt zu halluzinieren.',
  },
  {
    icon: ShieldCheck,
    title: 'Privacy by Architecture',
    text: 'Zwei Datenzonen. Sobald ein vertraulicher Treffer im Kontext liegt, beantwortet zwingend das lokale Modell — nachweislich ohne externen API-Call.',
  },
  {
    icon: Network,
    title: 'Wissens-Graph statt Textwüste',
    text: 'Papers, Konzepte, Modelle und Datasets samt Beziehungen. Jeder Fakt trägt seine Quell-Dokumente als Provenienz.',
  },
  {
    icon: RefreshCw,
    title: 'Wissen, das nachwächst',
    text: 'Ein Loop holt neue arXiv-Papers, extrahiert Fakten und hebt Neues hervor. Übernommen wird erst bei zwei unabhängigen Quellen — sonst Review.',
  },
]

const PIPELINE = [
  { step: '01', title: 'Erfassen', text: 'arXiv-PDFs und eigene Dokumente werden zu strukturiertem Markdown geparst.' },
  { step: '02', title: 'Indexieren', text: 'Heading-bewusstes Chunking, multilinguale Embeddings, Volltext-Index.' },
  { step: '03', title: 'Finden', text: 'Vektor- und Volltextsuche parallel, per Reciprocal Rank Fusion verschmolzen.' },
  { step: '04', title: 'Antworten', text: 'Zonen-Router wählt das Modell, die Antwort kommt mit Quellenangaben.' },
]

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-edge bg-surface px-4 py-3 text-center">
      <div className="text-2xl font-semibold tabular-nums text-primary-600 dark:text-primary-400">
        {value}
      </div>
      <div className="mt-0.5 text-xs text-muted">{label}</div>
    </div>
  )
}

export default function LandingPage() {
  const navigate = useNavigate()
  const { theme, toggleTheme } = useTheme()
  const [graph, setGraph] = useState<GraphData>(EMPTY)
  const [stats, setStats] = useState<Stats | null>(null)
  const [offline, setOffline] = useState(false)
  const { ref, width, height } = useElementSize<HTMLDivElement>()

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchGraph(), fetchDocuments()])
      .then(([g, docs]) => {
        if (cancelled) return
        setGraph(g)
        setStats({
          papers: docs.length,
          chunks: docs.reduce((sum, d) => sum + d.chunks, 0),
          nodes: g.nodes.length,
          edges: g.links.length,
        })
      })
      .catch(() => !cancelled && setOffline(true))
    return () => {
      cancelled = true
    }
  }, [])

  const kindColors = KIND_COLORS[theme]
  const kinds = Array.from(new Set(graph.nodes.map((n) => n.kind))) as NodeKind[]

  return (
    <div className="min-h-full bg-canvas">
      {/* Kopfzeile */}
      <header className="sticky top-0 z-30 border-b border-edge bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <span className="rounded-lg bg-primary-600 p-1.5 text-white">
            <Brain className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold sm:text-base">
            KI-Wissensmanagement-System
          </span>
          <button
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Helles Theme' : 'Dunkles Theme'}
            className="rounded-lg p-2 text-muted hover:bg-sunken hover:text-ink"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <Button size="sm" onClick={() => navigate('/chat')}>
            App öffnen
          </Button>
        </div>
      </header>

      {/* Hero */}
      <section className="border-b border-edge bg-gradient-to-b from-primary-50 to-canvas dark:from-primary-950/40">
        <div className="mx-auto max-w-6xl px-4 py-14 text-center sm:py-20">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary-200 bg-surface px-3 py-1 text-xs text-primary-700 dark:border-primary-800 dark:text-primary-300">
            <Boxes className="h-3.5 w-3.5" />
            RAG · Wissens-Graph · DSGVO-konform
          </span>
          <h1 className="mx-auto mt-5 max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
            Forschungswissen, das{' '}
            <span className="text-primary-600 dark:text-primary-400">Antworten belegt</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-muted sm:text-lg">
            Ein durchsuchbares Neurales Gedächtnis aus KI-Forschungsartikeln, ein daraus
            gewachsener Wissens-Graph und ein Chat, der jede Aussage mit Paper und Abschnitt
            belegt. Vertrauliche Dokumente bleiben dabei auf dem eigenen Rechner.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Button onClick={() => navigate('/chat')} icon={ArrowRight}>
              Frage stellen
            </Button>
            <Button variant="secondary" onClick={() => navigate('/wissen?tab=graph')} icon={Network}>
              Wissens-Graph ansehen
            </Button>
          </div>

          {/* Kennzahlen */}
          <div className="mx-auto mt-10 grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard value={stats ? String(stats.papers) : '—'} label="Papers im Gedächtnis" />
            <StatCard
              value={stats ? stats.chunks.toLocaleString('de-DE') : '—'}
              label="Chunks im Index"
            />
            <StatCard value={stats ? String(stats.nodes) : '—'} label="Graph-Knoten" />
            <StatCard value="0,94" label="Hit-Rate@5 (Golden-Set)" />
          </div>
          {offline && (
            <p className="mt-4 text-xs text-amber-600 dark:text-amber-400">
              Backend nicht erreichbar — Kennzahlen und Graph werden nachgeladen, sobald es läuft.
            </p>
          )}
        </div>
      </section>

      {/* Graph-Vorschau */}
      <section className="mx-auto max-w-6xl px-4 py-12 sm:py-16">
        <div className="mb-5 flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold sm:text-2xl">Der Graph, live aus der Datenbank</h2>
            <p className="mt-1 text-sm text-muted">
              Verifizierte Fakten aus dem Neuralen Gedächtnis — Knotengröße nach Verknüpfungsgrad,
              Farbe nach Typ.
              Unbestätigte Extraktionen bleiben ausgeblendet, bis sie belegt sind.
            </p>
          </div>
          <Link
            to="/wissen?tab=graph"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:underline dark:text-primary-400"
          >
            Im Graph erkunden <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="overflow-hidden rounded-2xl border border-edge bg-surface">
          <div ref={ref} className="relative h-[320px] sm:h-[440px]">
            {graph.nodes.length > 0 && width > 0 ? (
              <GlobePreview data={graph} width={width} height={height} theme={theme} />
            ) : (
              <div className="grid h-full place-items-center px-6 text-center text-sm text-muted">
                {offline
                  ? 'Graph wird geladen, sobald das Backend erreichbar ist.'
                  : 'Noch keine verifizierten Fakten — der Update-Loop füllt den Graphen.'}
              </div>
            )}
          </div>
          {kinds.length > 0 && (
            <div className="flex flex-wrap items-center gap-4 border-t border-edge px-4 py-2.5 text-xs text-muted">
              {kinds.map((k) => (
                <span key={k} className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: kindColors[k] }}
                  />
                  {k}
                </span>
              ))}
              {stats && (
                <span className="ml-auto tabular-nums">
                  {stats.nodes} Knoten · {stats.edges} Kanten
                </span>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Merkmale */}
      <section className="border-y border-edge bg-sunken/40">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:py-16">
          <h2 className="text-xl font-semibold sm:text-2xl">Wofür das gebaut ist</h2>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-2xl border border-edge bg-surface p-5">
                <span className="inline-flex rounded-xl bg-primary-100 p-2.5 text-primary-700 dark:bg-primary-950 dark:text-primary-300">
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="mt-3 font-semibold">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pipeline */}
      <section className="mx-auto max-w-6xl px-4 py-12 sm:py-16">
        <h2 className="text-xl font-semibold sm:text-2xl">Von der PDF zur belegten Antwort</h2>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PIPELINE.map(({ step, title, text }) => (
            <div key={step} className="rounded-2xl border border-edge bg-surface p-5">
              <span className="text-xs font-semibold tabular-nums text-primary-600 dark:text-primary-400">
                {step}
              </span>
              <h3 className="mt-1 font-semibold">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{text}</p>
            </div>
          ))}
        </div>

        <div
          className={cn(
            'mt-10 flex flex-wrap items-center justify-between gap-4 rounded-2xl px-6 py-7',
            'bg-primary-600 text-white dark:bg-primary-700',
          )}
        >
          <div className="min-w-0">
            <h3 className="text-lg font-semibold">Direkt ausprobieren</h3>
            <p className="mt-1 text-sm text-primary-100">
              Zum Beispiel: „Was ist Retrieval-Augmented Generation?" — Antwort samt Quellen.
            </p>
          </div>
          <Button
            variant="secondary"
            icon={FileSearch}
            onClick={() => navigate('/chat')}
            className="border-transparent bg-white text-primary-700 hover:bg-primary-50"
          >
            Chat öffnen
          </Button>
        </div>
      </section>

      <footer className="border-t border-edge">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 text-xs text-muted">
          <span>KI-Wissensmanagement-System · MIT-Lizenz</span>
          <span className="hidden sm:inline">
            FastAPI · Postgres/pgvector · Ollama · React · Docker
          </span>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1.5 hover:text-ink"
          >
            <Code2 className="h-4 w-4" />
            Quellcode
          </a>
        </div>
      </footer>
    </div>
  )
}
