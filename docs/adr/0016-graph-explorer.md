# ADR-0016: Graph-Explorer statt statischer Kräftegraph

Datum: 2026-08-10 · Status: akzeptiert · Erweitert ADR-0005

## Kontext

Die Graph-Ansicht war ein einzelner Kräftegraph: alle Kanten dauerhaft sichtbar,
ein Layout, Filter in einer Kopfleiste. Bei 370 Knoten und 437 Kanten ist das ein
Knäuel — man sieht, dass es viel ist, aber nicht *was*. Gewünscht war eine
Explorer-Oberfläche: räumlich getrennte Wissenswelten, mehrere Layouts, ein
verschiebbares Menü, Leseansicht direkt neben dem Graphen.

## Entscheidung

Der Graph bleibt 2D (`react-force-graph-2d`, Canvas). Kein three.js, kein WebGL:
Die Vorlagen sind ohnehin Projektionen, und ein zweites Rendering-Ökosystem
wäre für 370 Knoten unverhältnismäßig.

**Positionierung.** Nur die Wolke wird von der Kräftesimulation gestellt (plus
einer eigenen Kraft, die jeden Knoten an sein Cluster-Zentrum zieht). Globus,
Ring und Ebenen berechnen ihre Zielpositionen selbst
(`components/graph/layouts.ts`, reine Funktionen); der Canvas zieht die Knoten in
`onRenderFramePre` weich dorthin und pinnt sie über `fx`/`fy`. Daraus ergeben
sich Layout-Wechsel als Animation, eine leichte Drift („die Kugeln leben") und
Tiefe (`depth` steuert Radius und Deckkraft) — ohne zweite Render-Schleife, da
`autoPauseRedraw={false}` ohnehin jeden Frame zeichnet.

**Gruppierung.** Zwei Modi: nach Typ (paper/concept/model/dataset) und nach
Thema. Thema = **Zusammenhangskomponente**, nicht Label-Propagation. Der Korpus
zerfällt real in ~48 Komponenten (größte 58 Knoten), weil geteilte Konzepte nur
bei kanonisch gleichem Namen zusammenfallen (ADR-0012); Label-Propagation
zerfaserte darauf in Dutzende Splitter mit Papertiteln als Namen. Die zehn
größten Inseln bekommen eine eigene Farbe und werden nach ihrem bestvernetzten
**Konzept** benannt, der Rest wird zu einem Sammelsektor „Weitere Inseln".

**Systemschichten.** Ring und Ebenen brauchen eine Mitte. Neben den Graphdaten
zeichnet die Szene deshalb synthetische Knoten: den Systemkern, die lokalen
Projekte (localStorage, ADR-0006) und die externen Dienste (arXiv, Mistral-API,
Semantic Scholar, Postgres+pgvector, n8n, MCP). Projekte hängen über
`source_document_ids` an echten Papers, sind also keine Deko. Abschaltbar über
„Systemebenen".

**Ebenen als Spalten.** Die Ebenenansicht stellt die Wissensbereiche als
Rasterspalten auf eine gemeinsame Fußlinie — die Spaltenhöhe ist damit selbst die
Aussage („so viel steckt in diesem Bereich"), ohne dass eine Zahl danebenstehen
muss. Unter der Fußlinie liegen die Systemschichten als einzelne Reihen
(Dienste ▸ Projekte ▸ Kern), links beschriftet in der Farbe ihrer Knoten.

**Leuchten.** Auf dunklem Grund bekommen Knoten einen additiven Halo
(`globalCompositeOperation = 'lighter'`): große Knoten und Hubs einen
Radialverlauf, das Punktraster nur einen einfachen Kreis mit niedriger Deckkraft
— ein Gradient je Knoten und Frame wäre bei mehreren hundert Knoten zu teuer. Im
hellen Theme bleibt es flach, dort trübt Bloom nur. Abschaltbar über „Leuchten".

**Ruhe im Bild.** Kanten sind standardmäßig unsichtbar und erscheinen erst beim
Überfahren eines Knotens. Zusätzlich verdichten „Detail-Tiefe" (behält die
bestvernetzten Knoten, Gruppenköpfe immer) und „Kollabieren" (eine Gruppe wird
ein Hub-Knoten, Kanten wandern mit und werden aufaddiert).

## Konsequenzen

- `components/graph/` trennt Logik (scene, layouts, settings — testbar, 27 neue
  Tests) von Darstellung (Canvas, Panel, Minimap, Reader).
- Einstellungen und Menü-Position liegen unter `kwms.v1.graph.prefs`; kaputte
  Stände fallen auf Defaults zurück, statt die Ansicht zu sprengen.
- Die Leseansicht lädt den Volltext über `GET /documents/{id}` (ADR-0007) und
  zeigt die ersten 6.000 Zeichen; Weiterlesen führt auf die Dokumentseite.
- `prefers-reduced-motion` schaltet Drift und Rotation ab, ebenso der Schalter
  „Bewegung".
- Die Landing-Page benutzt weiterhin den schlanken `GraphView` — ein Teaser
  braucht kein Menü.
- Grenze: Die Themen-Cluster sind nur so gut wie die Kanten. Wächst der Korpus
  und verschmelzen Konzepte, werden die Inseln größer — der Sammelsektor ist
  ein Maß dafür, wie zerfasert der Graph gerade ist.
