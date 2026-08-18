# ADR-0020: Provenienz als Tabellen statt als JSONB-Feld

Datum: 2026-08-18 · Status: akzeptiert · Behebt eine Grenze aus ADR-0017 · Ergänzt ADR-0010, ADR-0018

## Kontext

Provenienz lebte bisher in zwei JSONB-Feldern: `meta.source_document_ids` an dem,
was die LLM-Extraktion schreibt (ADR-0010), und `meta.provenance` an dem, was aus
einer Fremdquelle importiert wird (ADR-0017).

Das trägt genau so lange, wie eine Aussage eine Quelle hat. Sobald zwei Quellen
dieselbe Aussage belegen, überschreibt der Upsert die eine mit der anderen —
ADR-0017 hat das als bekannte Grenze notiert (2 von 11 Knoten im ersten Test).
Ein Löschen „alles von Quelle X" hätte damit auch eigene Fakten getroffen. Und die
Promotionsregel aus Phase 8 („≥ 2 unabhängige Quellen") zählte Einträge in einem
Array, das gar nicht dafür gebaut war.

## Entscheidung

Vier Tabellen (Migration `0005`):

| Tabelle | Trägt |
|---|---|
| `document_sources` | woher ein Dokument stammt — mehrere Quellen je Dokument |
| `authors` | Autor:innen als eigene Zeilen, **ohne** Kontaktfelder |
| `document_authors` | Zuordnung samt Reihenfolge |
| `entities_extracted` | eine Zeile **je Beleg**: welche Aussage, welche Quelle, welcher Extraktor, welche Konfidenz, im Konflikt ja/nein |

**Eine Zeile je Beleg, nicht je Aussage.** Das ist der ganze Punkt: Dieselbe
Aussage aus zwei Quellen ergibt zwei Zeilen. `sources_for()` beantwortet damit die
Frage, die das JSONB-Feld nicht beantworten konnte — wird dieser Knoten von der
eigenen Extraktion **und** von einer Fremdquelle getragen?

**`document_id` in `document_sources` darf NULL sein.** Der Harvester kennt einen
Datensatz, lange bevor ein PDF geholt und ein Dokument angelegt ist (ADR-0018).
Das ist die dort angekündigte Naht: `DbSink` schreibt Quellenzeilen ohne Dokument,
die Zuordnung kommt später.

**Datenschutz steht als CHECK, nicht als Konvention.** `authors` weist Namen mit
`@` und Meta-Schlüssel wie `email`/`contact`/`phone` auf Datenbankebene ab. Eine
Regel, die nur in der Anwendung steht, hält keine zweite Schreibstelle auf. Namen
mit Adresse werden **verworfen, nicht bereinigt** — ein Name, in dem eine Adresse
steckt, ist ein Parsefehler, und den still zu reparieren verdeckt ihn.

**Autor:innen-Identität gilt je Quellsystem, nicht global.** `UNIQUE
(source_system, name_key)`. „P. Lewis" aus arXiv mit „Patrick Lewis" aus
OpenReview zu verschmelzen wäre genau die Cross-Source-Anreicherung auf
Personenebene, die dieses Projekt nicht betreibt (PLAN §7 Phase 11). Der Preis:
dieselbe Person steht mehrfach in der Tabelle. Das ist beabsichtigt.

**Konflikte werden markiert und bleiben markiert.** Ein weiterer Import mit
`conflict=False` löscht eine bestehende Markierung nicht (`conflict OR excluded`).
Aufgelöst wird im Review, nicht im Import (PLAN §2.7).

**`UNIQUE NULLS NOT DISTINCT`** (PG15+) für den Belegschlüssel — ohne das wäre
jede Zeile mit einer NULL-Spalte für den Index einzigartig und der Upsert liefe
ins Leere statt zu deduplizieren.

**Die JSONB-Felder bleiben.** Sie werden weiter geschrieben; die Belegzeilen
kommen zusätzlich. Ein Umbau der Lese- und Promotionspfade in derselben Änderung
hätte die Phase-8-Schleife angefasst, die läuft und getestet ist.

## Konsequenzen

- Schreibwege angebunden: PwC-Import (`rule:paperswithcode`), LLM-Extraktion
  (`llm:extract`), Harvester (`DbSink`).
- `scripts/backfill_provenance.py` trägt den Bestand nach. Am echten Graphen
  gelaufen: 12.772 Knoten- und 24.425 Kantenbelege aus Fremdquellen, 376 bzw. 451
  aus der Extraktion, in 1:45 min. Knoten ohne Beleg: **12.461 → 141**.
- **13 Knoten und 1 Kante werden jetzt von beiden Extraktoren getragen** —
  „Retrieval-Augmented Generation", „Transformer", „Attention", „CIFAR-10" unter
  anderem. Genau diese Fälle hat der Upsert vorher still überschrieben.
- 47 verwaiste Dokumentverweise (gelöschte Dokumente) wurden übersprungen statt
  eingetragen — ein gelöschtes Dokument taugt nicht als Beleg.
- **Neu sichtbar geworden:** 77 Namen existieren unter mehr als einer Knotenart
  („BERT" als `concept` **und** `model`, „AudioCaps" als `dataset` **und**
  `task`). PwC leitet die Art aus der Fundstelle ab, die LLM-Extraktion aus dem
  Text; `canonical_key` dedupliziert nur innerhalb einer Art (ADR-0012). Dadurch
  treffen sich beide Extraktoren seltener auf demselben Knoten, als sie sollten.
  Ob „Dense Passage Retrieval" ein Modell oder ein Konzept ist, lässt sich nicht
  nebenbei in einem Provenienz-Schritt entscheiden — das gehört zur
  Entitätsauflösung und bleibt offen.
- Die Promotionsregel könnte jetzt auf `independent_source_count()` umstellen
  statt Array-Einträge zu zählen. Noch nicht getan: Das ändert, welche Fakten
  `verified` werden, und gehört mit einer Messung vorher/nachher zusammen.
