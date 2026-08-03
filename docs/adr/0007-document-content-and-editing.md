# ADR-0007: Dokument-Content-Speicherung & Markdown-Editing

Datum: 2026-08-03 · Status: akzeptiert

## Kontext

Das neue Frontend braucht einen Dokument-Reader (PDF-Ergebnis und Markdown im
UI lesen) und In-UI-Editing für Markdown-Dateien mit anschließendem Re-Index.
Bisher gab es keinen Endpoint für Dokument-Inhalte; Chunks (mit ~150 Zeichen
Overlap und Hard-Windowing) lassen sich nur verlustbehaftet wieder zusammensetzen.

## Entscheidung

1. **Neue Spalte `documents.content_md`** (Migration `0002`, nullable): volles
   Markdown zum Ingest-Zeitpunkt (Docling-Output bei PDFs, Rohtext bei
   Markdown-Uploads). Für Alt-Dokumente (NULL) liefert `GET /documents/{id}`
   eine Chunk-Reassemblierung mit `content_source: "reassembled"` — gut genug
   zum Anzeigen, nie als Editier-Quelle (`editable: false`).
   Verworfen: Ablage in `meta` (JSONB) — würde jeden Meta-Read aufblähen.
2. **Nur `source_type == "markdown"` ist editierbar.** PDFs sind Ableitungen
   ihrer Quelldatei; ein Edit würde die Provenienz brechen.
3. **Edit verschiebt den `content_hash`** (`PUT /documents/{id}/content`
   re-chunkt + re-embeddet, löscht alte Chunks, aktualisiert Hash + Datei unter
   `data/uploads/`). Konsequenz: Der alte Hash verschwindet — ein erneuter
   Upload der Ur-Datei legt ein neues Dokument an. Akzeptiert. 409 bei
   identischem Inhalt eines anderen Dokuments (Idempotenz-Schutz).
4. **404 statt 403** für nicht-öffentliche Dokumente ohne Admin-Key
   (kein Existenz-Leak über confidential-Bestände).

## Offene Punkte / Future Work

- `/ingest` und `PUT …/content` laufen weiterhin **synchron** (Docling +
  Embeddings im Request). Bei großen PDFs blockiert der Request; das UI zeigt
  einen Hinweis. Ein Job-Queue-Umbau ist bewusst nicht Teil dieser Phase.
