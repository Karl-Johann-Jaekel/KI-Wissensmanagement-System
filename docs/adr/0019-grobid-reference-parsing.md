# ADR-0019: GROBID als optionaler Parser — Referenzen statt Fließtext

Datum: 2026-08-18 · Status: akzeptiert · Ergänzt ADR-0011

## Kontext

Docling parst PDFs nach Markdown und liefert damit Text plus Überschriften — genug
für Chunks, Embeddings und Retrieval. Das Literaturverzeichnis bleibt dabei
Fließtext: eine Liste von Zeichenketten, aus der sich keine Kante bauen lässt.

PLAN §1 führte den „vollständigen Zitationsgraph (CITES via Referenz-Parsing)"
deshalb als Nicht-Ziel. Genau daran hängt aber der Wert eines Wissens-Graphen über
Forschung: Wer zitiert wen, welche Arbeit ist Grundlage welcher anderen. ADR-0013
half sich mit Zitations*zahlen* von Semantic Scholar — eine Zahl am Knoten, keine
Kante zwischen zweien.

GROBID ist der etablierte Weg, aus einem PDF strukturiertes TEI-XML zu machen,
inklusive aufgeschlüsselter Referenzen (Titel, Autor:innen, Jahr, DOI).

## Entscheidung

**GROBID kommt als eigener Compose-Dienst hinzu, ersetzt Docling aber nicht.**
Docling bleibt der Standardweg des Ingests (ADR-0011); GROBID ist ein zweiter
Parser für den Fall, dass die Struktur gebraucht wird.

**Das CRF-Image, nicht die Deep-Learning-Variante.** `grobid/grobid:0.9.1-crf`
wiegt 0,5 GB, `-full` 14,8 GB — und letztere ist ohne GPU nicht schneller,
sondern langsamer. Für einen CPU-VPS (PLAN §4) ist die Wahl eindeutig.

**Eigenes Profil `grobid`, nicht in `full`.** Der Dienst belegt rund 3 GB RAM.
Wer ihn nicht braucht, soll ihn nicht starten müssen.

**Referenzen gehören nicht in die Chunks.** `to_markdown()` gibt Titel, Abstract
und Sektionen aus, das Literaturverzeichnis nicht — als Chunk wären 69 Titel nur
Rauschen im Retrieval. Sie sind Material für den Graphen, nicht für die Suche.

**Keine Kontaktdaten.** GROBID extrahiert `<email>` je Autor:in; das Feld wird
nicht gelesen. Am echten Beispiel geprüft: Das TEI von *Attention Is All You Need*
enthält `avaswani@google.com`, das geparste Dokument nicht.

**Der Nahtstelle zur Pipeline ist eine Funktion.** `markdown_from_pdf` hat die
Signatur, die `ingest_file(..., to_md=…)` erwartet — GROBID lässt sich einhängen,
ohne die Pipeline zu ändern.

## Konsequenzen

- Am echten Korpus geprüft (18.08.2026):
  *Retrieval-Augmented Generation …* → 41 Sektionen, 69 Referenzen, davon 69 mit
  Titel, 68 mit Jahr, 21 mit DOI, 69 mit Autor:innen.
  *Attention Is All You Need* → 25 Sektionen, 39 Referenzen. Rund 40 s je Paper
  auf CPU.
- Damit ist der Zitationsgraph technisch erreichbar. Gebaut wird er hier noch
  nicht — die Kanten brauchen erst das Provenienz-Schema (Phase 11.5), sonst
  entstünde wieder eine Kante ohne Beleg.
- **Bekannte Grenze:** GROBID verparst ungewöhnliche Autorenblöcke. Bei *Attention
  Is All You Need* landeten „Google Brain" und „Google Research" als `persName`
  in der Autorenliste — ein Fehler des Modells, nicht des Parsers hier. Eine
  Heuristik dagegen („klingt nach Firma") würde echte Namen treffen; wer es sauber
  braucht, konfiguriert `consolidateHeader` gegen Crossref. Die Autorenliste des
  RAG-Papers war fehlerfrei, das Problem ist also nicht systematisch.
- Nur 21 von 69 Referenzen tragen eine DOI. Für den Zitationsgraphen wird der
  Titelschlüssel deshalb der Hauptpfad sein — dieselbe Dedupe-Regel wie im
  Harvester (ADR-0018).
- Das TEI eines echten Papers enthält dessen Volltext und darf nicht ins Repo
  (PLAN §2.5). Das Test-Fixture ist deshalb selbst getextet.
