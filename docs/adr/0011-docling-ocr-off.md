# ADR-0011: Docling-OCR standardmäßig aus

Datum: 2026-08-03 · Status: akzeptiert

## Kontext

Beim ersten größeren Korpus-Lauf (40 neue arXiv-Papers) wurde der Ingest-Prozess
nach 33 Papers vom OOM-Killer beendet (`OOMKilled=true` am Backend-Container,
Docker/WSL2 mit ~7 GB). Der Lauf brach damit vor Extraktion und Promotion ab.

Docling lief mit Standardoptionen, also **`do_ocr=True`**. Im Log stapelten sich
`RapidOCR: The text detection result is empty`-Warnungen: Die OCR-Stufe lief über
Seiten, die bereits eine Textebene hatten, und lieferte erwartungsgemäß nichts.
Sie kostete dabei den Speicher-Peak und den Großteil der Laufzeit
(~5–6 min pro Paper).

## Entscheidung

`DocumentConverter` wird mit expliziten `PdfPipelineOptions` gebaut:

- `do_ocr = False` (Env `DOCLING_OCR`) — arXiv-Papers sind born-digital,
  ihre Textebene ist vorhanden (PLAN §4 nennt das bereits als Annahme).
- `do_table_structure = True` (Env `DOCLING_TABLE_STRUCTURE`) — Tabellen-
  erkennung bleibt an, sie ist deutlich leichter als OCR und für Papers relevant.

## Konsequenzen

- Gemessen: 7 Papers in 8,6 min statt zuvor ~5–6 min **pro** Paper; kein OOM,
  keine fehlgeschlagenen Dateien.
- **Gescannte PDFs** liefern ohne OCR keinen Text und landen als `empty` —
  für solche Bestände `DOCLING_OCR=true` setzen (dann aber kleinere Batches
  fahren oder WSL2 mehr Speicher geben).
- Die 33 Papers aus dem abgebrochenen Lauf wurden noch **mit** OCR geparst.
  Sie bleiben, wie sie sind; ein Reindex lohnt den Aufwand nicht, da OCR bei
  born-digital Text im Wesentlichen Rauschen aus Abbildungen ergänzt hat.
