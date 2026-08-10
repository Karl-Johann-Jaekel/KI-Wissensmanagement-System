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
- Lokal bleibt alles wie gehabt: Ollama für Embeddings und für vertrauliche Chats.
