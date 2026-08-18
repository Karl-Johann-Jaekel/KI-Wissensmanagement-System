# ADR-0017: Fremdquellen im Graphen — Papers with Code als Kaltstart

Datum: 2026-08-18 · Status: akzeptiert · Erweitert ADR-0004, ADR-0012

## Kontext

Der Wissens-Graph wuchs bisher ausschließlich aus dem eigenen arXiv-Korpus: 56
Papers, 370 Knoten, jede Kante von einem LLM aus Volltext extrahiert und über die
Promotion-Regeln (ADR-0010) gehoben. Das ist belastbar, aber langsam — und der
Graph zerfällt in Inseln, weil geteilte Konzepte nur bei kanonisch gleichem Namen
zusammenfallen (ADR-0012).

Eine globale Wissensdatenbank zu KI-Forschung existiert nicht in einer Form, die
Souveränität, Provenienz und rekursive Updates zugleich abdeckt. Es gibt vier
Teillandschaften: bibliografische Substrate (OpenAlex, Semantic Scholar,
Crossref), semantische aber schmale Systeme (ORKG, AI-KG), fragmentierte
KI-spezifische Werkzeuge (Epoch AI, AI Index) und eingestellte Vorgänger
(Microsoft Academic Graph, **Papers with Code**).

Papers with Code wurde Mitte 2025 abgeschaltet; das Archiv liegt als CC-BY-SA-Dump
vor — Papers, Code-Repos, Datensätze, Tasks, Modelle und SOTA-Zeilen, bereits
strukturiert. Damit ist es der beste verfügbare Kaltstart-Datensatz für genau
diesen Graphen.

## Entscheidung

**Der Dump wird als Adapter importiert, nicht als zweiter Graph geführt.**
`app/corpus/pwc.py` normalisiert auf dieselben Tabellen (`graph_nodes`,
`graph_edges`) und dieselben Alias-Regeln (`canonical_key`, ADR-0012). Ein
Dump-Eintrag „retrieval-augmented generation" landet auf dem Knoten, den die
LLM-Extraktion als „Retrieval-Augmented Generation" angelegt hat.

**Schema-Erweiterung (Migration `0004`).** Knotenart `task` kommt hinzu; `repo`
existiert seit Phase 1 und wird für Code-Repositories wiederverwendet statt neu
erfunden (ADR-0004 hat das Schema absichtlich stehen lassen). Neue Kanten:

| Kante | Bedeutung | Quelle im Dump |
|---|---|---|
| `repo IMPLEMENTS paper` | Implementierung eines Papers | `links-between-papers-and-code` |
| `paper USES_DATASET dataset` | Paper wertet auf dem Datensatz aus | `evaluation-tables` |
| `model ACHIEVES_SOTA dataset` | SOTA-Zeile inkl. Metriken in `meta` | `evaluation-tables` |
| `paper RELATED_TO task` | Aufgabengebiet | `papers-with-abstracts.tasks` |
| `paper USES concept` | verwendete Methode | `papers-with-abstracts.methods` |
| `paper INTRODUCES model` | Paper führt das Modell ein | `evaluation-tables` |

Die CHECKs werden ersetzt, nicht entfernt: ein freies TEXT-Feld ließe Tippfehler
still durch und fragmentiert den Graphen.

**Status `verified`, nicht `pending`.** PLAN §2.7 verlangt `pending` für
LLM-extrahierte Fakten — der Schutz gilt der Halluzination, nicht kuratierten
Fremddaten. Der Import ist deterministisch, wie schon der regelbasierte
Manifest-Import aus Phase 1. `--status pending` bleibt als Schalter für den Fall,
dass ein Dump erst durch die Review-Queue soll.

**Provenienz ist Pflicht.** Jeder importierte Knoten und jede Kante trägt
`meta.provenance = {source, source_url, fetched_at, license}`. Für
LLM-Extraktionen bleibt `meta.source_document_ids` das Provenienzfeld — beide
Wege sind belegt, keiner ist optional. Ein Index auf
`meta->'provenance'->>'source'` macht den Löschpfad und den Quellenfilter
bezahlbar.

**Teilmenge statt Vollimport.** `--limit` (Default 5.000) und `--match` (Regex auf
Titel, Abstract, Tasks) schneiden den Dump auf die Themen des Korpus zu. Nur
Repos, Datensätze und SOTA-Zeilen, die an einem Paper der Teilmenge hängen,
kommen mit — sonst treibt der Import Zehntausende unverbundener Inseln in den
Graphen.

**`GET /graph` bekommt `source` und `limit`.** Der Quellenfilter trennt
`paperswithcode` von `native` (eigener Korpus); das Knotenlimit (Default 2.000,
nach Vernetzungsgrad) hält die Force-Simulation im Frontend flüssig.

**Abstracts nach pgvector nur auf Ansage.** `--ingest-abstracts` legt die
Abstracts als Dokumente an und bettet sie ein. Der Dump ist CC-BY-SA, der Text
darf also gespeichert werden — 5.000 Abstracts kosten aber 5.000
Embedding-Aufrufe. Für arXiv-, OpenReview- und Semantic-Scholar-Abstracts gilt
das ausdrücklich **nicht** (dort nur invertierter Index, keine Rohtexte).

## Konsequenzen

- Der Graph startet nicht mehr bei null; die Zitations- und Implementierungs-
  dichte wird sofort sichtbar.
- Die Lizenz wandert mit: CC-BY-SA-4.0 steht an jedem importierten Knoten. Wer
  den Graphen weitergibt, gibt ihn unter Share-alike weiter. Deshalb ist die
  Quelle im Frontend filterbar und nicht mit eigenen Fakten vermischt darstellbar.
- **Bekannte Grenze:** `meta.provenance` ist ein einzelnes Objekt. Trifft der
  Import auf einen Knoten, den schon die eigene Extraktion angelegt hat, mischt
  der Upsert die Provenienz hinein — der Knoten sieht danach aus, als käme er von
  Papers with Code. Beim Praxistest betraf das 2 von 11 Knoten. Ein Löschen „alles
  von Quelle X" würde damit auch eigene Fakten treffen. Mehrfach-Provenienz
  bekommt deshalb eine eigene Tabelle (`document_sources`, Schritt 5); bis dahin
  gilt `source=paperswithcode` als „auch von PwC belegt", nicht als „stammt von".
- Ein Titel ist der Identitätsschlüssel eines Papers. Zwei Papers gleichen Titels
  verschmelzen — akzeptabel, weil `meta.arxiv_id` den Unterschied dokumentiert;
  ein DOI-basierter Schlüssel kommt mit dem Harvester (Schritt 3).
- Der Dump ist ein Standbild von Mitte 2025 und altert. Aktualität kommt aus dem
  Update-Loop (Phase 8) und dem Delta-Harvesting, nicht aus dieser Quelle.
