# ADR-0024: Schreibrouten in Produktion abgeschaltet

Status: akzeptiert
Datum: 2026-09-01

## Kontext

Das System läuft öffentlich unter https://wissen.jaekel.dev. Drei Schreibrouten waren
dort erreichbar:

- `POST /ingest` — Upload von PDF/Markdown
- `PUT /documents/{id}/content` — Markdown bearbeiten (ADR-0007)
- `DELETE /documents/{id}`

Alle drei hingen allein am Admin-Key, der als einfacher String-Vergleich geprüft wird.
Seit dem UI-Redesign (`16cacfa`) bietet die Oberfläche keinen davon mehr an: das
Upload-Panel und der Markdown-Editor wurden entfernt. Die Routen waren damit
Angriffsfläche ohne Gegenwert.

Der Upload-Pfad trägt zusätzlich drei Fehler, die auf einem öffentlichen Server
schwerer wiegen als lokal:

1. Der Handler ist `async`, ruft aber synchron Docling und blockierende Embeddings.
   Während eines PDFs steht der Event-Loop — samt laufender SSE-Streams.
2. Der Request-Body wird ohne Größengrenze in den RAM gelesen; die vorhandene Prüfung
   greift nur im Markdown-Zweig.
3. Uploads landen unter `data/uploads/<basename>`. Zwei PDFs gleichen Namens
   überschreiben sich auf der Platte, obwohl die DB per `content_hash` korrekt
   dedupliziert — die DB zeigt danach auf fremde Bytes.

## Entscheidung

Ein Setting `WRITES_ENABLED` (Standard `false`) schaltet alle drei Routen ab. Die
Dependency `require_writes_enabled` antwortet mit **404**, nicht 403: nach außen soll
der Endpunkt nicht existieren. Ein 403 verriete, dass es ihn gibt und nur der Schlüssel
fehlt.

Der Deploy-Gate (`scripts/check_prod_ready.py`) prüft, dass die Routen in Produktion
zu sind.

Die drei Upload-Fehler werden **nicht** behoben. Sie sind als Kommentar am Endpunkt
festgehalten und vor einer Wiederinbetriebnahme abzuarbeiten. Aufwand in einen Pfad zu
stecken, der abgeschaltet bleibt, lohnt nicht.

## Konsequenzen

- Der Korpus wird über `python -m app.ingest data/corpus` befüllt, nicht über HTTP.
  Das war ohnehin der dokumentierte Weg.
- Lokale Entwicklung setzt `WRITES_ENABLED=true` in der `.env`.
- Der n8n-Ingest-Webhook (`automation/ingest-webhook.workflow.json`) zeigt auf ein
  Ziel, das es in Produktion nicht mehr gibt, und entfällt.
- Kommt die Upload-Funktion zurück, sind zuerst die drei Fehler oben zu beheben und
  dieser ADR abzulösen.
