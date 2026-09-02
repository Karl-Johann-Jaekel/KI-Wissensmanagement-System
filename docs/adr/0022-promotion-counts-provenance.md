# ADR-0022: Promotion zählt Belege, nicht das JSONB-Feld

Datum: 2026-09-01 · Status: akzeptiert · Setzt ADR-0020 in Kraft · Löst die Zählung aus ADR-0010 ab

## Kontext

Die regelbasierte Promotion (Phase 8) verlangt **≥ 2 unabhängige Quellen**, bevor ein
extrahierter Knoten von `pending` auf `verified` wechselt. Gezählt wurden dafür
Dokument-Ids in `edge.meta["source_document_ids"]` — also in genau dem JSONB-Feld, das
ADR-0020 als „gar nicht dafür gebaut" abgelöst hat.

Zwei Fehler trafen zusammen:

1. **Die Liste wurde ersetzt, nicht ergänzt.** Der Upsert führte `meta` mit `||`
   zusammen, einem flachen Merge. Behaupten zwei Papers dieselbe Kante, treffen beide
   denselben Primärschlüssel `(source, target, relation)` — und die Quelle des ersten
   verschwand. Der Knoten blieb einquellig und wurde nie promotet.
2. **Die Belegtabelle wurde nie gelesen.** `independent_source_count`, `sources_for`
   und `mark_conflict` aus ADR-0020 waren exportiert und getestet, aber von keinem
   Produktionspfad aufgerufen. Die 37.197 nachgetragenen Belege lagen ungenutzt da.

Messbar am Bestand: über die Belegtabelle haben **17** Knoten mindestens zwei
unabhängige Quellen, über das JSONB-Feld nur **7**.

## Entscheidung

`promote_graph` zählt über `entities_extracted` — eine Zeile je Beleg, gezählt nach
unterschiedlichem Herkunftsdokument (ersatzweise Quellsystem). Die Zählung läuft als
eine Sammelabfrage (`independent_source_counts_by_node`), nicht je Knoten einzeln: die
Schleife geht über den gesamten Graphen.

Das JSONB-Feld bleibt erhalten und wird beim Upsert nun **vereinigt** statt ersetzt.
Es dient der Nachvollziehbarkeit im `meta` des promoteten Knotens; die Entscheidung
trifft es nicht mehr. Zusätzlich hält `meta.independent_sources` fest, worauf die
Promotion sich gestützt hat.

**Ohne Beleg keine Promotion.** Ein Knoten ohne Zeile in `entities_extracted` bleibt
`pending`, auch wenn sein JSONB-Feld drei Quellen behauptet. Provenienz ist Pflicht
(PLAN §2.7), nicht Beiwerk — und ein Feld, das der Upsert überschreiben konnte, trägt
keine Gewähr dafür, je vollständig gewesen zu sein.

## Konsequenzen

- Die 2-Quellen-Regel arbeitet erstmals auf der Datengrundlage, für die ADR-0020
  gebaut wurde.
- Knoten, deren Belege vor dieser Änderung verlorengingen, gewinnen sie nicht zurück.
  Der Verlust ist gestoppt, nicht rückgängig gemacht; die Belege entstehen bei der
  nächsten Extraktion neu.
- Ein Schreibweg, der Knoten anlegt, ohne `record_extraction` aufzurufen, produziert
  ab jetzt dauerhaft `pending`-Knoten. Das ist beabsichtigt und beim Anlegen neuer
  Importwege zu beachten.
- `mark_conflict` und `sources_for` sind weiterhin ungenutzt. Sie gehören zur
  Konfliktmarkierung, die noch aussteht.
