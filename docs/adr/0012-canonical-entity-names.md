# ADR-0012: Kanonische Entitätsnamen bei der Extraktion

Datum: 2026-08-03 · Status: akzeptiert

## Kontext

Nach 56 Papers standen 316 pending-Fakten in der Queue — **jeder mit exakt einer
Quelle**. Die Zwei-Quellen-Regel der Promotion konnte damit nie greifen. Die
Annahme „mehr Papers ⇒ mehr Deckung" war falsch: Der Graph fragmentierte, weil
jedes Paper seine eigenen Begriffe prägte.

Eine Stichprobe der extrahierten Konzeptnamen zeigte drei verschiedene Defekte:

| Defekt | Beispiel |
|---|---|
| Satzfragment statt Begriff | `existing efforts within these three frameworks` |
| mehrere Begriffe in einem Feld | `KG-enhanced LLMs, LLM-augmented KGs, Synergized LLMs + KGs` |
| Klammerzusatz / paper-eigene Prägung | `knowledge graph (KG)`, `Blank-Free Rendering` |

Reine Schreibweisen-Normalisierung hätte davon fast nichts eingefangen: über den
gesamten Bestand ließen sich damit nur **3 von 379** Knoten zusammenfassen.

## Entscheidung

Vier Maßnahmen, die zusammen wirken:

1. **`canonical_key(name)`** in `aliases.py` als Identitätsschlüssel neben dem
   Anzeigenamen: Kleinschreibung, Klammerzusätze, Satzzeichen, Bindestriche und
   einfache Pluralformen fallen weg, Aliasse greifen auf der flachen Form.
   `Cross-Encoder`, `cross encoder` und `Cross Encoders` sind ein Knoten.
2. **`is_plausible_entity`** verwirft Satzfragmente (> 6 Wörter, > 60 Zeichen,
   Prosa-Marker wie „existing", „within", „these").
3. **`split_entities`** trennt Aufzählungen in einem Feld an Komma/Semikolon.
4. **Vokabular im Prompt**: Die bereits bekannten Konzepte werden der Extraktion
   als Vorschlagsliste mitgegeben, samt Regel „nimm den etablierten Begriff,
   auch wenn das Paper es anders formuliert". Dieselbe Tabelle dient beim
   Speichern als Nachschlagewerk, damit eine Variante auf den vorhandenen
   Knoten zeigt statt einen zweiten anzulegen. Das Vokabular wächst innerhalb
   eines Laufs mit.

## Wirkung

Trockenlauf über 5 Papers mit dem neuen Prompt: **8 von 10 extrahierten
Konzepten trafen bekanntes Vokabular** (vorher praktisch null Wiederverwendung).

Einschränkung: Diese 5 Papers haben selbst zum Vokabular beigetragen, die Quote
ist also optimistisch. Belastbar wird sie erst beim nächsten Lauf über ungesehene
Papers.

## Konsequenzen

- Bestehende Knoten werden **nicht** rückwirkend zusammengeführt (nur 3 Fälle,
  eine Merge-Migration wäre unverhältnismäßig). Neue Extraktionen docken an die
  vorhandene Schreibweise an.
- Der Filter kann seltene, legitim lange Namen verwerfen (z. B. voll
  ausgeschriebene Benchmark-Titel). Bewusst in Kauf genommen: ein fehlender
  Knoten ist harmloser als ein Satzfragment im öffentlichen Graphen.
- Die Regel bleibt konfigurierbar (ADR-0010); mit `PROMOTE_MIN_SOURCES=1` hängt
  die Graphqualität allein an dieser Extraktionsqualität.
