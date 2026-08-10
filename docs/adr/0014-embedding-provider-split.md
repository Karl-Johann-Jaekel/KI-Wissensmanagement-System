# ADR-0014: Embedding-Anbieter je Betriebsart (kleiner VPS ohne Ollama)

Datum: 2026-08-04 · Status: akzeptiert

## Kontext

Der öffentliche Server soll ein kleiner VPS sein — ohne GPU, mit wenig RAM.
Ollama dort zu betreiben ist weder sinnvoll noch nötig. Nach Bestandsaufnahme
braucht der öffentliche Betrieb Ollama an genau **einer** Stelle:

| Funktion | öffentlicher Betrieb | Bedarf |
|---|---|---|
| Chat-Generierung | Mistral EU-API (Zonen-Router) | kein Ollama |
| Faktenextraktion | `choose_client("public")` → Mistral | kein Ollama |
| Reranker | standardmäßig aus, wäre lokal (torch) | aus lassen |
| **Query-Embeddings** | **Ollama** | **Blocker** |

Jede Suche und jeder Chat bettet die Frage ein. Ohne Embeddings gibt es keine
Vektorsuche — der VPS wäre auf Volltext reduziert.

## Entscheidung

**`EMBED_PROVIDER` wählt den Anbieter:**

* `ollama` (Default) — lokaler Betrieb. Nichts verlässt den Rechner; für die Zone
  `confidential` bleibt das die einzige zulässige Option.
* `mistral` — EU-API mit AVV, Modell `mistral-embed`. Liefert wie das bisherige
  Modell **1024 Dimensionen**, das Schema (`vector(1024)`) bleibt unverändert,
  eine Migration entfällt.

**Ein Bestand trägt genau ein Modell** (ADR-0002 gilt unverändert). Vektoren
verschiedener Modelle liegen in verschiedenen Räumen — gemischt liefert die Suche
weiterhin Treffer, nur die falschen. Drei Sicherungen dagegen:

1. `embed_model` steht an jedem Chunk (wie bisher).
2. `assert_index_matches_settings()` bricht laut ab, statt still Unsinn zu liefern.
3. Der Deploy-Gate prüft `EMBED_PROVIDER` und die Übereinstimmung von Index und
   Konfiguration.

**`scripts/reindex.py`** (in PLAN §7 versprochen, bislang nicht vorhanden) bettet
den Bestand auf das Zielmodell um: fortsetzbar, stapelweise, mit Dimensionsprüfung
vor dem ersten Schreibvorgang und optionalem Filter auf eine Zone.

## Gemessen

Umstellung des Bestands (6.950 Chunks) auf `mistral-embed`, Golden-Eval davor
und danach:

| | Hit-Rate@5 | Latenz p50 | Latenz p95 |
|---|---|---|---|
| `qwen3-embedding:0.6b` (Ollama) | 0,88 (14/16) | 220 ms | 250 ms |
| `mistral-embed` (EU-API) | **0,94 (15/16)** | 281 ms | 436 ms |

Die Befürchtung, ein nicht ausdrücklich multilinguales Modell könnte bei
deutschen Fragen einbrechen, hat sich nicht bestätigt — im Gegenteil, ein
zusätzlicher Treffer. Die höhere Latenz ist der Netzweg zur API und liegt weit
unter der Antwortzeit des Sprachmodells. Der Reindex dauerte rund vier Minuten.

## Konsequenzen

- **Rollenteilung:** Der Korpus wird lokal gebaut (Docling ist speicherhungrig —
  ein 40-Paper-Lauf hat hier 14 GB RAM gesprengt, siehe ADR-0011) und als
  Datenbank-Dump auf den VPS gespielt (`scripts/backup.sh` + Restore-Runbook).
  Der VPS bleibt ein dünner Leseserver: FastAPI, Postgres, Caddy.
- Die öffentliche Instanz hängt damit an einem externen Dienst für Embeddings.
  Das ist die bewusste Gegenleistung für einen kleinen Server; die Zone
  `confidential` ist davon nicht betroffen, weil sie dort nicht existiert
  (Deploy-Gate).
- Der Wechsel kostet einen vollständigen Reindex des öffentlichen Bestands
  (aktuell 6.950 Chunks) über die API.
- **Ein Bestand kann nicht beide Zonen tragen, sobald ein entfernter Anbieter im
  Spiel ist.** Embeddings sehen den vollen Chunk-Text; vertraulicher Inhalt darf
  ihn nicht erreichen. Der Ingest bricht deshalb ab, wenn `sensitivity != public`
  auf `EMBED_PROVIDER != ollama` trifft, und `reindex.py` überspringt solche
  Chunks. Eine private Bibliothek braucht damit einen **eigenen lokalen Bestand**
  mit `EMBED_PROVIDER=ollama` — nicht dieselbe Datenbank wie der öffentliche
  Korpus.
- Tests dürfen nicht an der `.env` hängen: Eine autouse-Fixture legt den Anbieter
  für die Suite auf `ollama` fest.
