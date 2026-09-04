/**
 * Die drei Diagrammformen der Wabenansicht: Ring, Jahresbalken, Messbalken.
 *
 * Bewusst als reines SVG ohne Diagrammbibliothek — es sind drei Formen, und die
 * Anwendung zieht mit react-force-graph bereits d3 in einen eigenen Chunk. Eine
 * zweite Grafikbibliothek für vier Kreissegmente wäre schlecht bezahlt.
 */
import type { Bucket } from './hive'

const REST_COLOR = '#475569' // slate-600 — „Sonstige" tritt zurück.

interface DonutProps {
  buckets: Bucket[]
  rest?: number
  size?: number
  /** Zahl in der Mitte; ohne Angabe die Summe. */
  total?: number
  label?: string
}

/**
 * Ringdiagramm über die Hauptgruppen.
 *
 * Gezeichnet über `stroke-dasharray` auf einem Kreis: ein Pfad je Segment, kein
 * Bogen-Rechnen, und die Segmente bleiben bei jeder Größe sauber gerundet.
 */
export function Donut({ buckets, rest = 0, size = 132, total, label }: DonutProps) {
  const parts = rest > 0 ? [...buckets, { label: 'Sonstige', count: rest, color: REST_COLOR }] : buckets
  const sum = parts.reduce((acc, b) => acc + b.count, 0)
  const radius = size / 2 - 11
  const circumference = 2 * Math.PI * radius
  let offset = 0

  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        <g transform={`translate(${size / 2} ${size / 2}) rotate(-90)`}>
          <circle r={radius} fill="none" stroke="rgb(var(--c-sunken))" strokeWidth={13} />
          {sum > 0 &&
            parts.map((part) => {
              const share = part.count / sum
              // 1,5 px Lücke zwischen den Segmenten — sonst verschwimmen zwei
              // benachbarte Farben zu einem Band.
              const length = Math.max(0, share * circumference - 1.5)
              const dash = `${length} ${circumference - length}`
              const el = (
                <circle
                  key={part.label}
                  r={radius}
                  fill="none"
                  stroke={part.color ?? REST_COLOR}
                  strokeWidth={13}
                  strokeLinecap="round"
                  strokeDasharray={dash}
                  strokeDashoffset={-offset}
                />
              )
              offset += share * circumference
              return el
            })}
        </g>
        <text
          x={size / 2}
          y={size / 2 - 2}
          textAnchor="middle"
          className="fill-ink text-[15px] font-semibold tabular-nums"
        >
          {(total ?? sum).toLocaleString('de-DE')}
        </text>
        {label && (
          <text
            x={size / 2}
            y={size / 2 + 13}
            textAnchor="middle"
            className="fill-muted text-[9px] uppercase tracking-wider"
          >
            {label}
          </text>
        )}
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5 text-xs">
        {parts.map((part) => (
          <li key={part.label} className="flex items-center gap-2">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: part.color ?? REST_COLOR }}
            />
            <span className="min-w-0 flex-1 truncate text-muted" title={part.label}>
              {part.label}
            </span>
            <span className="shrink-0 tabular-nums text-ink">
              {part.count.toLocaleString('de-DE')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

interface BarsProps {
  buckets: Bucket[]
  color: string
  height?: number
  /** Beschriftete Jahre; ohne Angabe rund sechs gleichmäßig verteilte. */
  ticks?: number
}

/** Jahresbalken. Leere Jahre bleiben als Lücke stehen (siehe `timeline`). */
export function Bars({ buckets, color, height = 96, ticks = 6 }: BarsProps) {
  if (buckets.length === 0) {
    return <p className="text-xs text-muted">Für diesen Bereich ist kein Datum hinterlegt.</p>
  }
  const max = Math.max(...buckets.map((b) => b.count), 1)
  const step = Math.max(1, Math.round(buckets.length / ticks))

  return (
    <div>
      <div className="flex items-end gap-[2px]" style={{ height }}>
        {buckets.map((b) => (
          <div
            key={b.label}
            className="group relative flex-1"
            style={{ height: '100%' }}
            title={`${b.label}: ${b.count.toLocaleString('de-DE')}`}
          >
            <div
              className="absolute bottom-0 w-full rounded-t-[2px] transition-[height] duration-500"
              style={{
                height: `${Math.max(b.count > 0 ? 2 : 0, (b.count / max) * 100)}%`,
                backgroundColor: color,
                opacity: 0.45 + 0.55 * (b.count / max),
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[2px] text-[9px] tabular-nums text-muted">
        {buckets.map((b, i) => (
          <span key={b.label} className="flex-1 text-center">
            {i % step === 0 ? b.label : ' '}
          </span>
        ))}
      </div>
    </div>
  )
}

interface MeterProps {
  buckets: Bucket[]
  color: string
  /** Bezugswert für die Balkenlänge; ohne Angabe der größte Eintrag. */
  max?: number
  limit?: number
  rank?: boolean
}

/** Rangliste mit hinterlegtem Messbalken — für Quellen und Verbindungen. */
export function Meter({ buckets, color, max, limit = 6, rank = false }: MeterProps) {
  const shown = buckets.slice(0, limit)
  if (shown.length === 0) return <p className="text-xs text-muted">Keine Einträge.</p>
  const top = max ?? Math.max(...shown.map((b) => b.count), 1)

  return (
    <ol className="space-y-1.5">
      {shown.map((b, i) => (
        <li key={b.label} className="relative overflow-hidden rounded-md">
          <div
            className="absolute inset-y-0 left-0 rounded-md transition-[width] duration-500"
            style={{ width: `${(b.count / top) * 100}%`, backgroundColor: color, opacity: 0.16 }}
          />
          <div className="relative flex items-center gap-2 px-2 py-1 text-xs">
            {rank && <span className="w-3 shrink-0 tabular-nums text-muted">{i + 1}</span>}
            <span className="min-w-0 flex-1 truncate text-ink" title={b.label}>
              {b.label}
            </span>
            <span className="shrink-0 tabular-nums text-muted">
              {b.count.toLocaleString('de-DE')}
            </span>
          </div>
        </li>
      ))}
    </ol>
  )
}
