# KI-Wissensmanagement-System

RAG-System über KI-Forschungsliteratur mit Zitationspflicht, dazu ein Wissens-Graph
mit belegter Herkunft je Aussage und ein wiederkehrender Lauf, der beides aktuell hält.

56 arXiv-Papers · 6.950 Chunks · 13.271 Graph-Knoten / 24.920 Kanten · 38.026 Belege
· Hit-Rate@5 **0,94** · 239 Tests · 20 ADRs

```
Frage ──▶ Hybrid-Retrieval ──▶ Kontext ──▶ LLM ──▶ Antwort mit Quellenangabe
          (Vektor + Volltext,                       │
           RRF-fusioniert)                          └─▶ Faktenextraktion ──▶ Graph
                                                          (pending ──▶ verified)
```

---

## Stand

|  |  |
|---|---|
| **Umfang** | Solo-Projekt, 22.07.–18.08.2026 · 62 Commits · 213 Dateien · 12 Phasen nach [PLAN.md](PLAN.md) |
| **Bestand** | 56 indexierte Papers (6.950 Chunks); Graph aus 13.271 Knoten — rund 370 aus eigener LLM-Extraktion, der Rest aus dem Papers-with-Code-Archiv |
| **Retrieval** | Hit-Rate@5 0,94 (15 von 16 Golden-Fragen, deutsch und englisch), p95 221 ms |
| **Stack** | FastAPI · Postgres 16 + pgvector · SQLAlchemy/Alembic · Docling · GROBID · Mistral EU-API · React 18 + TypeScript + Tailwind · Docker · GitHub Actions |
| **Datenschutz** | EU-Verarbeitung; Konversationen liegen im Browser, nicht auf dem Server; keine Paper-PDFs im Repo; Autorentabelle ohne Kontaktfelder (per CHECK erzwungen) |
| **Betrieb** | Lokal und im Prod-Stack lauffähig, Deploy-Gate und Restore erprobt. Der Go-Live auf dem EU-VPS steht aus. |

## Kernstücke

| Datei | Was dort entschieden wird |
|---|---|
| [`retrieval/rrf.py`](backend/app/retrieval/rrf.py) | Wie Vektor- und Volltexttreffer zu einer Rangfolge verschmelzen |
| [`corpus/promote.py`](backend/app/corpus/promote.py) | Wann ein extrahierter Fakt von `pending` nach `verified` wechselt |
| [`db/provenance.py`](backend/app/db/provenance.py) | Welche Quelle welche Aussage belegt — eine Zeile je Beleg, nicht je Aussage |
| [`corpus/harvest/base.py`](backend/app/corpus/harvest/base.py) | Ratenbegrenzung, Backoff, Dedupe; Abstracts nur als invertierter Index |
| [`components/graph/scene.ts`](frontend/src/components/graph/scene.ts) | Wie aus dem Graph-Payload Cluster, Ebenen und Farben werden |
| [`docs/adr/`](docs/adr/) | 20 Architecture Decision Records, einschließlich der revidierten |

---

## Einrichten

```bash
git clone https://github.com/Karl-Johann-Jaekel/KI-Wissensmanagement-System
cd KI-Wissensmanagement-System
cp .env.example .env          # MISTRAL_API_KEY eintragen
docker compose up -d          # Postgres + Backend
docker compose exec backend alembic upgrade head

# Korpus holen und indexieren
docker compose exec backend python scripts/fetch_corpus.py
docker compose exec backend python -m app.ingest data/corpus

cd frontend && npm install && npm run dev     # http://localhost:5173
```

Ohne API-Schlüssel läuft alles gegen ein lokales Ollama-Modell weiter — langsamer,
und die Wahl muss **vor** dem Indexieren fallen: Index und Query brauchen dasselbe
Embedding-Modell (ADR-0002), ein Wechsel erzwingt `scripts/reindex.py`.

### Papers-with-Code-Archiv importieren

Der Graph wächst sonst Paper für Paper aus der LLM-Extraktion. Wer ihn sofort
gefüllt sehen will, importiert das CC-BY-SA-Archiv von Papers with Code (Dienst
Mitte 2025 abgeschaltet). Der ursprüngliche Host ging mit unter; das Archiv liegt
heute als Parquet unter der Organisation
[`pwc-archive`](https://huggingface.co/pwc-archive) auf Hugging Face:

```bash
# Dump holen (~750 MB nach data/pwc/, idempotent, überspringt Vorhandenes)
docker compose exec backend python scripts/fetch_pwc_dump.py --out data/pwc

# Teilmenge zum Thema des Korpus, nur Graph (kein Embedding-Aufwand)
docker compose exec backend python -m app.corpus.pwc \
    --dump data/pwc --limit 5000 --match "retrieval|rag|agent|reranking"

docker compose exec backend python -m app.corpus.pwc --dump data/pwc --dry-run  # nur zählen
```

Der Import ist idempotent und regelbasiert, die Fakten sind deshalb direkt
`verified`; jeder Knoten trägt `meta.provenance` mit Quelle, URL, Zeitpunkt und
Lizenz (ADR-0017). `--ingest-abstracts` legt zusätzlich die Abstracts als
Dokumente in pgvector ab — erlaubt, weil der Dump CC-BY-SA steht. Im Graphen
trennt `GET /graph?source=paperswithcode|native` die Fremdquelle vom eigenen
Bestand.

### Laufend ernten: arXiv und OpenReview

Der Seed-Korpus kam über die arXiv-Query-API. Die kennt kein Änderungsdatum — für
laufende Aktualität harvestet `app.corpus.harvest` per **OAI-PMH** über
`from`/`until` auf dem Änderungszeitstempel und findet damit auch überarbeitete
Fassungen bereits bekannter Papers:

```bash
docker compose exec backend python -m app.corpus.harvest --source arxiv --since 2026-08-01
docker compose exec backend python -m app.corpus.harvest --source arxiv   # ab letztem Lauf
```

Läufe sind wiederaufnehmbar (Zeitmarke und Blätter-Zeiger in
`data/harvest/state.json`), höflich (`Retry-After` schlägt die eigene Wartekurve)
und erkennen Dubletten über DOI **und** Titelschlüssel — quellenübergreifend, weil
dieselbe Arbeit auf arXiv und OpenReview steht.

**Abstracts werden nie als Rohtext gespeichert**, sondern nur als invertierter
Index (`{Token: [Positionen]}`, wie bei OpenAlex). Der Datentyp hat schlicht kein
Feld dafür. Volltexte kommen ausschließlich aus CC-lizenzierten Quellen.
Autorenfelder werden von Kontaktdaten bereinigt (ADR-0018).

OpenReview (`--source openreview --venue ICLR.cc/2025/Conference`) verlangt seit
2026 ein kostenloses Konto — anonyme Zugriffe beantwortet der Dienst mit einer
Browser-Challenge, die dieses Projekt bewusst nicht umgeht.
`OPENREVIEW_USERNAME`/`OPENREVIEW_PASSWORD` setzen.

### Referenzen aufschlüsseln: GROBID

Docling liefert Text und Überschriften — das Literaturverzeichnis bleibt dabei
Fließtext. GROBID zerlegt genau diesen Teil und macht Referenzen zu Feldern
(Titel, Autor:innen, Jahr, DOI). Damit wird der Zitationsgraph erreichbar, den
PLAN §1 bisher als Nicht-Ziel führte.

```bash
docker compose --profile grobid up -d          # CRF-Image, 1,7 GB auf Platte
docker compose exec backend python -m app.ingestion.grobid data/corpus/2005.11401.pdf
docker compose exec backend python -m app.ingestion.grobid <pdf> --json      # volle Struktur
docker compose exec backend python -m app.ingestion.grobid <pdf> --markdown  # für den Chunker
```

Optional und opt-in: Docling bleibt der Standardweg des Ingests (ADR-0011), der
Dienst belegt rund 3 GB RAM. Am RAG-Paper: 41 Sektionen, 69 Referenzen, davon 69
mit Titel, 68 mit Jahr, 21 mit DOI — rund 40 s je Paper auf CPU. Autoren-E-Mails
liefert GROBID mit, dieses Projekt liest sie nicht (ADR-0019).

### Herkunft je Aussage

Jede Aussage im Graphen trägt ihre Belege in eigenen Zeilen — eine je Beleg, nicht
eine je Aussage. Damit sind mehrere Quellen für denselben Fakt überhaupt
darstellbar; im vorherigen JSONB-Feld überschrieb die zweite Quelle die erste.

```sql
document_sources    -- woher ein Dokument stammt (mehrere je Dokument)
authors             -- Autor:innen als Zeilen, ohne Kontaktfelder
document_authors    -- Zuordnung samt Reihenfolge
entities_extracted  -- welche Aussage, welche Quelle, welcher Extraktor, Konflikt ja/nein
```

Zwei Regeln stehen als CHECK in der Datenbank, nicht als Konvention im Code:
Autorennamen mit `@` und Meta-Schlüssel wie `email` werden abgewiesen. Und
Autor:innen-Identität gilt **je Quellsystem** — „P. Lewis" aus arXiv mit „Patrick
Lewis" aus OpenReview zu verschmelzen wäre Profilbildung über Quellen hinweg, die
dieses Projekt nicht betreibt. Dieselbe Person steht deshalb bewusst mehrfach.

```bash
docker compose exec backend python scripts/backfill_provenance.py --dry-run
docker compose exec backend python scripts/backfill_provenance.py
```

Am echten Bestand: 37.197 Belege nachgetragen, Knoten ohne Beleg 12.461 → 141.
Von der eigenen Extraktion **und** von Papers with Code getragen werden 13 Knoten —
„Retrieval-Augmented Generation", „Transformer", „Attention" unter anderem. Genau
diese Fälle gingen vorher still verloren (ADR-0020).

---

## Oberfläche

Eine React-SPA mit Sidebar-Navigation, hellem und dunklem Theme, mobiltauglich:

| Bereich | Was es tut |
|---|---|
| **Chat** | Streamende Antworten mit Quellenkarten. Verläufe bleiben im Browser (localStorage), nicht auf dem Server. |
| **Suche** | Hybrid-Retrieval mit aufklappbaren Scores je Verfahren — sichtbar, warum ein Treffer oben steht. |
| **Wissen** | Dokumente hochladen (PDF und Markdown), lesen, Markdown direkt im Browser bearbeiten (Speichern indexiert neu). Dazu der Graph-Explorer. |
| **Inbox** | Review-Queue der unbestätigten Fakten mit Filtern und Sammelfreigabe. |
| **Skills** | Wiederverwendbare Prompt-Vorlagen, per „/" in den Chat einsetzbar. |
| **Projekte** | Arbeitsbereiche, die Chats und Dokumente bündeln. |

Der Graph zeichnet vielzitierte Grundlagenarbeiten mit einem goldenen Ring aus.
Die Zitationszahlen stammen von Semantic Scholar und liegen bislang nur für die 56
Papers des eigenen Korpus vor, nicht für die importierten Knoten. Die Knotengröße
bleibt dem Vernetzungsgrad vorbehalten — zwei Signale, zwei visuelle Kanäle.

**Der Graph-Explorer** (ADR-0016) zeigt denselben Bestand in vier Layouts:

- **Cloud** — Kräftesimulation, jedes Thema an sein eigenes Zentrum gezogen
- **Globus** — rotierende Kugel; Sektorbreite folgt der Knotenzahl, Tiefe steuert
  Größe und Deckkraft. Klick auf einen Knoten hält die Rotation an, Klick auf die
  Minimap schaltet sie um, Ziehen dreht von Hand
- **Ring** — Systemkern mittig, außen Wissenswelten als Sektoren, dann Projekte und
  externe Dienste auf Orbits
- **Ebenen** — Wissensbereiche als Rasterspalten auf einer Fußlinie, darunter die
  Systemschichten als Reihen

Gruppiert wird nach Zusammenhangskomponenten, solange der Graph ein Archipel ist,
und nach Themen, sobald eine Komponente ihn dominiert — die Cluster tragen dann den
Namen ihres Themenknotens („Retrieval", „Question Answering"). Kanten erscheinen erst
beim Überfahren eines Knotens; ein verschiebbares Menü trägt Suche, Regler
(Knotengröße, Cluster-Abstand, Streuung, Detail-Tiefe) und das Kollabieren ganzer
Cluster zu einem Hub. Ein Klick öffnet den Volltext des Quell-Dokuments daneben.

Importierte Fremdquellen bleiben unterscheidbar: Ein Quellenfilter im Menü trennt
den eigenen Korpus von Papers with Code, die Arten `Aufgaben` und `Code` tragen
eigene Farben, und die Leseansicht nennt zu jedem importierten Knoten Herkunft,
Lizenz und Abrufdatum (ADR-0017).

---

## Pipeline

**Aufnahme.** Docling parst PDFs zu Markdown, das Chunking folgt den Überschriften
statt einer festen Zeichenzahl. Jedes Dokument trägt einen Content-Hash: ein zweiter
Durchlauf fügt nichts hinzu. GROBID ist als zweiter Parser zuschaltbar und liefert
zusätzlich das Literaturverzeichnis als Felder.

**Retrieval.** Vektorsuche über pgvector (HNSW) und Postgres-Volltextsuche laufen
parallel und werden per Reciprocal Rank Fusion verschmolzen; ein Cross-Encoder-
Reranker ist optional zuschaltbar. Index und Query nutzen dasselbe multilinguale
Embedding-Modell — deutsche Fragen treffen damit auf englische Papers.

**Generation.** Der Kontext geht mit Zitationspflicht an das Sprachmodell, gestreamt
per Server-Sent Events. Antworten mit Quellenkarten, Tages-Token-Budget, Rate-Limit.
Ohne belastbaren Treffer antwortet das System „dazu liegt keine Quelle vor"; ein Test
hält das fest.

**Wissens-Graph.** Was das LLM aus einem Paper extrahiert, entsteht als `pending`.
Nach `verified` kommt es nur regelbasiert (mehrere unabhängige Belege) oder durch
Freigabe in der Review-Queue; Widersprüche werden als `disputed` markiert statt
überschrieben. Entitätsnamen werden kanonisiert, damit „Cross-Encoder", „cross
encoder" und „Cross Encoders" ein Knoten bleiben.

**Quellen.** Korpus und Graph füllen heute drei Wege: `scripts/fetch_corpus.py`
(arXiv-PDFs → Chunks), der Papers-with-Code-Import (Graph-Knoten) und eigene Uploads
über die Oberfläche. Die Harvester für arXiv-OAI-PMH und OpenReview erzeugen
normalisierte Datensätze und Quellenzeilen; sie an `documents` zu hängen und die PDFs
nachzuladen ist noch nicht verdrahtet.

Jede Aussage trägt ihre Belege in `entities_extracted`. Mehrfach belegt sind bislang
13 von 13.271 Knoten — nicht weil die Quellen sich selten decken, sondern weil sie
die Knotenart verschieden ableiten: „BERT" liegt als `concept` **und** als `model`
im Graphen, und dedupliziert wird nur innerhalb einer Art (ADR-0020).

---

## Qualitätssicherung

- **239 Tests**: 172 im Backend (Retrieval, Extraktion, Promotion, Provenienz-Schema,
  Harvester, GROBID-Parser, API, Deploy-Gate) und 67 im Frontend (Speicherschicht,
  Graph-Layouts, Clusterbildung, SSE-Parsing). DB-Tests laufen in Transaktionen mit
  Rollback; LLM und HTTP sind gemockt, kein Test geht ins Netz.
- **CI**: `ruff`, `mypy` und `gitleaks` in GitHub Actions, dazu ein Frontend-Job mit
  Typprüfung, Vitest und Produktionsbuild.
- **Deploy-Gate** vor jedem Rollout: prüft unter anderem, ob die Embeddings im Index
  zum konfigurierten Modell passen. Ein Mismatch liefert sonst still die falschen
  Treffer statt eines Fehlers.
- **Restore-Drill** real durchgeführt und protokolliert
  ([Runbook](docs/runbooks/restore.md)).

Datenschutz-Leitplanken stehen nicht nur im Code: Die Autorentabelle weist Namen mit
`@` und Meta-Schlüssel wie `email` per CHECK-Constraint ab, und Autor:innen-Identität
gilt je Quellsystem — dieselbe Person quellenübergreifend zu einem Profil zu
verschmelzen findet nicht statt (ADR-0020).

---

## Behobene Fehlerbilder

Jeder Fall ist im zugehörigen ADR mit Messung dokumentiert.

**Der Delta-Fetch holte die falschen Papers.** Die arXiv-Suche lautete
`all:retrieval augmented generation` — unquotiert bindet nur das erste Wort ans Feld.
Zusammen mit der Sortierung nach Datum kamen die neuesten Einreichungen *aller*
Disziplinen zurück: 20 von 40 Papers hatten keine Informatik-Kategorie. Behoben mit
quotierter Phrase und Kategorie-Klammer.

**Mehr Daten machten den Graphen nicht voller.** Nach 56 Papers hatten alle 316
unbestätigten Fakten exakt eine Quelle — die Regel „zwei unabhängige Belege" konnte
nie greifen. Ursache war nicht die Korpusgröße, sondern die Benennung: Jedes Paper
prägte eigene Begriffe. Gelöst durch kanonische Namen plus ein Vokabular im
Extraktions-Prompt.

**Ein Indexierungslauf wurde vom OOM-Killer beendet.** Docling lief mit
eingeschalteter OCR über born-digital PDFs — die Stufe lieferte nichts und
verbrauchte den ganzen Speicher. Ohne OCR: viermal schneller, kein Absturz.

**Der Import des Papers-with-Code-Archivs ebenfalls.** Die Parquet-Konvertierung hat
die SOTA-Metriken zu einem Struct mit 3.468 Spalten ausgerollt, typisch eine davon
belegt. Beim Umwandeln nach Python entstand das je Zeile. Der Typ wird jetzt in Arrow
verschlankt, bevor ein Python-Objekt existiert; die Metriknamen bleiben, die Werte
nicht.

**Nach dem Import überlebten 2 von 4.600 Code-Repos in der Graph-Antwort.** Das
Knotenlimit kappte global nach Vernetzungsgrad — ein Repo hängt per Definition an
genau einem Paper, also löschte die Rangliste systematisch die Blattarten. Gekappt
wird jetzt je Knotenart nach Bestandsanteil.

**Die Cluster-Ansicht wurde durch mehr Daten ärmer.** Gruppiert wurde nach
Zusammenhangskomponenten — passend für den dünnen Eigen-Korpus (größte Komponente
15,9 %), nach dem Import lagen 78,8 % aller Knoten in einer einzigen. Drei Verfahren
gemessen, keines taugte für beide Datenformen; jetzt entscheidet die Form der Daten,
ob nach Komponenten oder nach Themen gruppiert wird (größte Gruppe: 12,9 %).

**Der Globus verklumpte zur Sichel.** Jede Gruppe bekam denselben Längengrad-Sektor,
unabhängig von ihrer Größe: 1.018 Knoten auf 9,1 % der Fläche gegen 32 Knoten auf
ebenfalls 9,1 %. Die Sektorbreite folgt jetzt der Knotenzahl.

**`mcp_server/server.py` parste acht Tage lang nicht.** Ein Refactoring hatte den
schließenden `"""` des Modul-Docstrings mitgenommen. `ruff check .` meldete daraufhin
67 Syntaxfehler und der MCP-Server startete nicht — beides fiel erst beim nächsten
vollständigen Check-Lauf auf.

---

## Deployment

Der öffentliche Betrieb liest nur: Der Korpus wird lokal gebaut und als
Datenbank-Dump eingespielt, Embeddings und Antworten kommen über die Mistral-EU-API,
es läuft kein lokales Modell. Das Backend-Image ist dabei nicht schlank: rund 10 GB,
weil Docling und torch mitinstalliert sind. Im Prod-Betrieb werden sie nicht
aufgerufen, liegen aber im Image.

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile public up -d --build
docker compose exec -T backend python scripts/check_prod_ready.py    # Deploy-Gate
BASE_URL=https://<domain>/api ./scripts/smoke_prod.sh                # Smoke-Test
```

Caddy übernimmt TLS, liefert die SPA aus und proxied `/api` — ein Container für
alles drei. Backups laufen nächtlich per `pg_dump`, das Restore-Verfahren ist
erprobt.

---

## Projektstruktur

```
backend/app/
  ingestion/     Docling- und GROBID-Parsing, Chunking, Embeddings, Pipeline
  retrieval/     Hybrid-Suche, Reciprocal Rank Fusion, Reranker
  generation/    Prompts, LLM-Aufruf, SSE-Streaming
  corpus/        Update-Loop, Extraktion, Alias-Normalisierung,
                 harvest/ (OAI-PMH, OpenReview), pwc.py (Archiv-Import)
  db/            Modelle, Graph-Upserts, provenance.py, Migrationen
  api/           health · graph · search · chat · documents · review
frontend/src/    Chat · Suche · Inbox · Wissen · Skills · Projekte,
                 components/graph/ (Explorer: Szene, Layouts, Canvas, Minimap)
mcp_server/      MCP-Werkzeuge für Claude Desktop
eval/            Golden-Set, Hit-Rate-Messung, Parameter-Tuning
scripts/         Korpus-Fetch · PwC-Dump · Reindex · Provenienz-Backfill ·
                 Deploy-Gate · Smoke-Test · Backup
docs/            20 ADRs in adr/, Betriebsanleitungen in runbooks/
```

## Lizenz

Code: MIT — siehe [LICENSE](LICENSE).

Daten sind davon getrennt zu betrachten: Paper-PDFs unter `data/` sind git-ignoriert
und werden nie committet (arXiv-Standardlizenz erlaubt keine Weitergabe). Die aus dem
Papers-with-Code-Archiv importierten Graph-Knoten stehen unter CC-BY-SA-4.0; die
Lizenz steht an jedem importierten Knoten und wandert bei Weitergabe mit. Abstracts
aus arXiv, OpenReview und Semantic Scholar werden ausschließlich als invertierter
Index gespeichert, nicht als Rohtext.
