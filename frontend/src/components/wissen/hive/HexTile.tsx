/**
 * Eine Wabe: Sektorname, Bestandsgröße und eine Miniatur-Konstellation aus den
 * bestvernetzten Knoten des Sektors.
 *
 * Die Konstellation ist kein Ornament — die Punktgröße folgt der Vernetzung, und
 * ein Klick darauf öffnet denselben Knoten wie ein Klick im Graph-Explorer. Die
 * Wabe zeigt damit schon geschlossen, *was* in ihr liegt.
 */
import { constellation, hexPath, type HexPlacement, type HiveNode, type Sector } from './hive'

interface Props {
  sector: Sector
  place: HexPlacement
  /** Von einem Bereichsfilter ausgeschlossen — zurückgenommen, nicht entfernt. */
  dimmed: boolean
  hovered: boolean
  selectedNodeId: string | null
  onOpen: (sector: Sector) => void
  onHover: (sectorId: string | null) => void
  onPickNode: (node: HiveNode) => void
}

/** Punkte, die je Wabe gezeichnet werden. Mehr wird zum Grieß. */
const DOTS = 7

/** Der Kranz sitzt unter der Mitte — darüber stehen Sektorname und Anzahl. */
const DY = 12

export default function HexTile({
  sector,
  place,
  dimmed,
  hovered,
  selectedNodeId,
  onOpen,
  onHover,
  onPickNode,
}: Props) {
  const { cx, cy, r } = place
  const points = constellation(sector.nodes, r, DOTS)
  const title = `${sector.label} — ${sector.count.toLocaleString('de-DE')} Knoten`

  return (
    <g
      transform={`translate(${cx} ${cy})`}
      opacity={dimmed ? 0.28 : 1}
      className="transition-opacity duration-300"
      onMouseEnter={() => onHover(sector.id)}
      onMouseLeave={() => onHover(null)}
    >
      <g
        className="hive-tile"
        style={{ transform: hovered ? 'scale(1.045)' : 'scale(1)' }}
        role="button"
        tabIndex={0}
        aria-label={`${title}. Öffnet die Detailansicht.`}
        onClick={() => onOpen(sector)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen(sector)
          }
        }}
      >
        {/* Leuchten unter der Wabe — trägt die Farbe in den Hintergrund. */}
        <path
          d={hexPath(0, 0, r * 0.94)}
          fill={sector.color}
          opacity={hovered ? 0.22 : 0.1}
          filter={`url(#hive-glow-${sector.id})`}
          className="transition-opacity duration-300"
        />
        <path
          d={hexPath(0, 0, r)}
          fill={`url(#hive-fill-${sector.id})`}
          stroke={sector.color}
          strokeWidth={hovered ? 2.4 : 1.6}
          strokeLinejoin="round"
          opacity={hovered ? 1 : 0.82}
          className="transition-all duration-300"
        />

        {/* Kopfzeile der Wabe */}
        <text
          y={-r * 0.6}
          textAnchor="middle"
          fill={sector.color}
          className="text-[14px] font-semibold uppercase tracking-[0.14em]"
        >
          {sector.label}
        </text>
        <text
          y={-r * 0.6 + 15}
          textAnchor="middle"
          fill="rgb(var(--c-muted))"
          className="text-[12px] tabular-nums"
        >
          {sector.count.toLocaleString('de-DE')} Knoten
        </text>

        {/* Konstellation: Speichen, Nabe, Satelliten */}
        <g>
          {points.map((p) => (
            <line
              key={`spoke-${p.node.id}`}
              x1={0}
              y1={DY}
              x2={p.x}
              y2={p.y + DY}
              stroke={sector.color}
              strokeWidth={0.8}
              opacity={0.32}
            />
          ))}
          <circle cx={0} cy={DY} r={9} fill={sector.color} opacity={0.16} />
          <circle cx={0} cy={DY} r={5} fill={sector.color} opacity={0.9} />
          {points.map((p) => {
            const active = selectedNodeId === p.node.id
            return (
              <g key={p.node.id} transform={`translate(${p.x} ${p.y + DY})`}>
                {active && (
                  <circle r={p.size + 5} fill="none" stroke={sector.color} strokeWidth={1.4} />
                )}
                <circle
                  r={p.size}
                  fill={sector.color}
                  opacity={active ? 1 : 0.86}
                  className="hive-dot"
                  onClick={(e) => {
                    // Sonst öffnete derselbe Klick zusätzlich das Sektor-Popup.
                    e.stopPropagation()
                    onPickNode(p.node)
                  }}
                >
                  <title>{`${p.node.name} · Vernetzung ${Math.round(p.node.val)}`}</title>
                </circle>
              </g>
            )
          })}
        </g>

        {/* Fußzeile: Kanten des Sektors */}
        <text
          y={r * 0.68}
          textAnchor="middle"
          fill="rgb(var(--c-muted))"
          className="text-[11px] tabular-nums"
        >
          {sector.links.toLocaleString('de-DE')} Kanten
        </text>
      </g>
    </g>
  )
}
