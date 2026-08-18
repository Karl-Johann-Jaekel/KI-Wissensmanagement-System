/**
 * Kompakte Globus-Ansicht für die Landing-Page — dieselbe Rendering-Engine wie der
 * Graph-Explorer (`GraphCanvas` + `Minimap`), aber ohne Menü und Systemebenen: die
 * Startseite zeigt das Wissen, nicht die App-Architektur.
 *
 * Klick auf einen Knoten hält die Rotation an (zum Lesen); Klick ins Leere löst sie
 * wieder. Auf der Minimap unten links schaltet ein Klick die Rotation dauerhaft an
 * bzw. aus, Ziehen dreht den Globus von Hand — unabhängig davon, ob die Automatik
 * gerade läuft oder pausiert ist.
 */
import { useMemo, useRef, useState } from 'react'
import type { GraphData } from '../../types'
import GraphCanvas from './GraphCanvas'
import Minimap from './Minimap'
import { buildScene, type SceneNode, type Theme } from './scene'
import { DEFAULT_SETTINGS, type GraphSettings } from './settings'

interface Props {
  data: GraphData
  width: number
  height: number
  theme: Theme
}

const SETTINGS: GraphSettings = {
  ...DEFAULT_SETTINGS,
  layout: 'globe',
  groupMode: 'kind',
  showSystem: false,
  // Cluster-Namen und dauerhafte Labels würden die kleine Fläche zutexten; Namen
  // zeigen sich stattdessen bei Hover/Auswahl (GraphCanvas-Standardverhalten).
  hubLabels: false,
  // Kanten bleiben dauerhaft sichtbar (dezent) — sie zeigen auf den ersten Blick,
  // dass hier ein vernetzter Graph liegt, nicht nur verstreute Punkte.
  linksOnHover: false,
}

export default function GlobePreview({ data, width, height, theme }: Props) {
  const scene = useMemo(
    () => buildScene(data, { theme, groupMode: 'kind', showSystem: false }),
    [data, theme],
  )
  const [selected, setSelected] = useState<SceneNode | null>(null)
  const [fg, setFg] = useState<unknown>(null)
  const [dragging, setDragging] = useState(false)
  const [rotationPaused, setRotationPaused] = useState(false)
  const rotationOffsetRef = useRef(0)

  return (
    <div className="relative h-full w-full">
      <GraphCanvas
        key={theme}
        scene={scene}
        width={width}
        height={height}
        settings={SETTINGS}
        theme={theme}
        activeIds={null}
        selectedId={selected?.id ?? null}
        focus={null}
        paused={!!selected || dragging || rotationPaused}
        rotationOffsetRef={rotationOffsetRef}
        onNodeClick={setSelected}
        onBackgroundClick={() => setSelected(null)}
        onInstance={setFg}
      />
      <Minimap
        scene={scene}
        fg={fg}
        graphWidth={width}
        graphHeight={height}
        theme={theme}
        rotationOffsetRef={rotationOffsetRef}
        onRotateStateChange={setDragging}
        onToggleRotation={() => setRotationPaused((v) => !v)}
      />
    </div>
  )
}
