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

## Nachtrag (18.08.2026): Cluster-Bildung folgt der Datenform

Der Themen-Modus gruppierte nach Zusammenhangskomponenten. Das passte zum Archipel
des Eigen-Korpus (365 Knoten, 49 Komponenten, größte 15,9 %). Nach dem
Papers-with-Code-Import (ADR-0017) lagen **78,8 % aller Knoten in einer einzigen
Komponente** — vier Fünftel des Bildes in einer Farbe, benannt nach einem
zufälligen Knoten darin. Der Graph wirkte dadurch ärmer, nicht reicher.

Gemessen wurden drei Verfahren auf der echten Nutzlast:

| Verfahren | größte Gruppe (dicht) | größte Gruppe (nativ) |
|---|---|---|
| Zusammenhangskomponente | 78,8 % | 15,9 % |
| Label-Propagation | 66,8 % | zerfasert |
| Themenzuordnung (`task`/`concept`) | 12,9 % | zerfasert (199 Cluster) |

Keines taugt für beide Formen — deshalb entscheidet jetzt die Datenform:
Dominiert eine Komponente (≥ 35 % der Knoten **und** ≥ 50 Knoten), wird nach
Themen gruppiert, sonst bleibt es bei Komponenten. Themen-Cluster tragen den
Namen ihres Themenknotens („Retrieval", „Question Answering") statt der
Notlösung, den bestvernetzten Knoten zum Namensgeber zu machen.

Offen bleibt der Sammelsektor „Weitere Inseln": Er fasst alles jenseits der zehn
größten Cluster zusammen und liegt bei rund der Hälfte der Knoten — vor wie nach
dieser Änderung. Mehr Cluster brächten wenig (14 statt 10 Cluster decken 53,7 %
statt 49,0 % ab) und kosten unterscheidbare Farben.

## Nachtrag 2 (18.08.2026): Verteilung folgt der Knotenzahl

Nach dem Import kippten zwei Layouts, weil beide die **Gruppenzahl** verteilten
statt der **Knotenzahl**:

* **Globus** gab jeder Gruppe denselben Längengrad-Sektor. 1.018 Knoten auf 9,1 %
  der Fläche gegen 32 Knoten auf ebenfalls 9,1 % — Faktor 28 im Gedränge, sichtbar
  als verklumpte Sichel. Die Sektorbreite folgt jetzt der Knotenzahl (auf einer
  Kugel ist die Fläche eines Sektors proportional zu seiner Breite), mit einem
  Boden, damit Ein-Knoten-Gruppen nicht auf Bruchteile eines Grades zusammenfallen.
  Die Aufteilung ist als `globeSectors()` herausgezogen — aus fertigen
  Kugelkoordinaten zurückgerechnet ist sie nahe den Polen numerisch wertlos, als
  eigene Funktion dagegen prüfbar.
* **Ebenen** deckelte die Spaltenbreite bei 9 Rasterzellen. Die größte Gruppe wurde
  damit 9 breit und 114 hoch — ein Turm, der die Ansicht sprengte und alles andere
  auf Streichholzgröße schrumpfte. Ohne Deckel wächst die Breite mit der Wurzel der
  Knotenzahl: aus 9 × 114 werden 29 × 17, alle Spalten liegen unter 2,5 : 1.
  Die Systemreihen spannen sich jetzt über dieselbe Breite wie der Spaltenblock —
  auf festem Rasterabstand drängten sich sechs Dienste auf einem Fünftel der Fläche
  und ihre Namen überlagerten sich zu einer unlesbaren Zeile. Die Reihenbeschriftung
  steht am tatsächlichen linken Rand statt an einer festen Koordinate.

Dazu wird der Sammelsektor **nach Knotenart aufgefächert**, sobald er 120 Knoten
überschreitet. Er war kein Schwanz kleiner Inseln mehr, sondern die Hälfte des
Graphen in einer Farbe. Aus einem Block von 1.018 werden sechs Gruppen (Code 466,
Papers 203, Aufgaben 181, Konzepte 76, Modelle 42, Datasets 41); die größte Gruppe
der Ansicht sinkt von 50,9 % auf 23,3 %, und die Farbe sagt wenigstens noch, *was*
dort liegt. Insgesamt 18 statt 11 Gruppen.
