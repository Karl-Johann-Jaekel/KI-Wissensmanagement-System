# KI-Wissensmanagement-System

**Ein RAG-System über KI-Forschungsliteratur, das jede Antwort belegt — und einen
Wissens-Graphen, der nur aufnimmt, was durch eine Prüfung gekommen ist.**

56 arXiv-Papers · 6.950 indexierte Chunks · 370 Graph-Knoten · Hit-Rate@5 **0,94**
· 113 automatisierte Tests

```
Frage ──▶ Hybrid-Retrieval ──▶ Kontext ──▶ LLM ──▶ Antwort mit Quellenangabe
          (Vektor + Volltext,                       │
           RRF-fusioniert)                          └─▶ Faktenextraktion ──▶ Graph
                                                          (pending ──▶ verified)
```

---

## Warum das mehr ist als ein RAG-Tutorial

Die meisten RAG-Demos enden bei „Frage rein, Antwort raus". Die interessanten
Probleme fangen danach an — und genau die behandelt dieses Projekt:

**Antworten sind überprüfbar.** Jede Aussage nennt Paper und Abschnitt. Findet das
Retrieval keine belastbare Stelle, sagt das System „Dazu liegt keine Quelle vor",
statt zu raten. Der Systemprompt erzwingt das, ein Test hält es fest.

**Der Graph nimmt nichts ungeprüft auf.** Was das LLM aus einem Paper extrahiert,
landet als `pending` — mit Pflicht-Provenienz auf jeder Kante. Verifiziert wird nur
regelbasiert (mehrere unabhängige Quellen) oder durch menschliche Freigabe.
Widersprüchliche Behauptungen werden als `disputed` markiert statt still
überschrieben.

**Qualität wird gemessen, nicht behauptet.** Ein Golden-Set aus 16 Fragen (deutsch
und englisch) misst die Hit-Rate bei jedem Durchlauf. Als die Embeddings gewechselt
wurden, lag die Zahl vorher und nachher auf dem Tisch: 0,88 → 0,94.

**Entscheidungen sind dokumentiert.** 15 Architecture Decision Records halten fest,
was warum entschieden wurde — inklusive der Fälle, in denen sich eine Annahme als
falsch herausstellte und der Weg korrigiert wurde.

---

## Live ausprobieren

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

Ohne API-Schlüssel läuft alles gegen ein lokales Ollama-Modell weiter — nur eben
langsamer.

---

## Die Oberfläche

Eine React-SPA mit Sidebar-Navigation, hellem und dunklem Theme, mobiltauglich:

| Bereich | Was es tut |
|---|---|
| **Chat** | Streamende Antworten mit Quellenkarten. Verläufe bleiben im Browser (localStorage), nicht auf dem Server. |
| **Suche** | Hybrid-Retrieval mit aufklappbaren Scores je Verfahren — sichtbar, warum ein Treffer oben steht. |
| **Wissen** | Dokumente hochladen (PDF und Markdown), lesen, Markdown direkt im Browser bearbeiten (Speichern indexiert neu). Dazu der Graph-Explorer. |
| **Inbox** | Review-Queue der unbestätigten Fakten mit Filtern und Sammelfreigabe. |
| **Skills** | Wiederverwendbare Prompt-Vorlagen, per „/" in den Chat einsetzbar. |
| **Projekte** | Arbeitsbereiche, die Chats und Dokumente bündeln. |

Der Graph zeichnet vielzitierte Grundlagenarbeiten mit einem goldenen Ring aus
(Zitationszahlen von Semantic Scholar). Die Knotengröße bleibt dem
Vernetzungsgrad vorbehalten — zwei Signale, zwei visuelle Kanäle.

**Der Graph-Explorer** (ADR-0016) zeigt denselben Bestand in vier Layouts:
*Cloud* (Kräftesimulation mit getrennten Cluster-Zentren), *Globus* (rotierende
Kugel mit Tiefenschärfe), *Ring* (Systemkern in der Mitte, außen Wissenswelten
als Sektoren, dann Projekte und externe Dienste auf Orbits) und *Ebenen* (die
Systemschichten vertikal gestapelt). Kanten bleiben unsichtbar, bis man einen
Knoten überfährt; ein verschiebbares Menü trägt Suche, Regler (Knotengröße,
Cluster-Abstand, Streuung, Detail-Tiefe) und das Kollabieren ganzer Cluster zu
einem Hub. Ein Klick öffnet die Leseansicht mit dem Volltext des Quell-Dokuments
direkt neben dem Graphen.

---

## Wie es funktioniert

**Aufnahme.** Docling parst PDFs zu Markdown, das Chunking folgt den Überschriften
statt einer festen Zeichenzahl. Jedes Dokument trägt einen Content-Hash: ein
zweiter Durchlauf fügt nichts hinzu.

**Retrieval.** Zwei Verfahren laufen parallel — Vektorsuche über pgvector (HNSW)
und Postgres-Volltextsuche — und werden per Reciprocal Rank Fusion verschmolzen.
Ein Cross-Encoder-Reranker ist optional zuschaltbar. Ein multilinguales
Embedding-Modell für Index **und** Query lässt deutsche Fragen auf englischen
Papers funktionieren.

**Generation.** Der Kontext geht mit Zitationspflicht an das Sprachmodell,
gestreamt per Server-Sent Events. Antworten mit Quellenkarten, Tages-Token-Budget
und Rate-Limit.

**Wissens-Graph.** Ein wiederkehrender Lauf holt neue arXiv-Papers, extrahiert
Fakten, hebt Neues hervor und schlägt Kandidaten zur Freigabe vor. Entitätsnamen
werden kanonisiert, damit „Cross-Encoder", „cross encoder" und „Cross Encoders"
ein Knoten bleiben und der Graph nicht zerfasert.

---

## Technisch

**Backend** FastAPI · Postgres 16 + pgvector · SQLAlchemy · Alembic · Docling ·
Mistral EU-API · Ollama (lokal)
**Frontend** React 18 · TypeScript · Vite · Tailwind · react-force-graph
**Betrieb** Docker Compose · Caddy (TLS, SPA, API-Proxy) · GitHub Actions
**Weiteres** MCP-Server für Claude Desktop · n8n-Workflows · pg_dump-Backups

**Qualitätssicherung**

- 113 automatisierte Tests (Retrieval, Extraktion, Promotion, API, Deploy-Gate).
  DB-Tests laufen in Transaktionen mit Rollback, LLM und HTTP sind gemockt.
- `ruff`, `mypy` und `gitleaks` in GitHub Actions, dazu ein Frontend-Job mit
  Typprüfung, Vitest und Produktionsbuild.
- Ein Deploy-Gate prüft vor jedem Rollout, ob der Server tatsächlich ausliefern
  kann — unter anderem, ob die Embeddings im Index zum konfigurierten Modell
  passen. Ein solcher Fehler liefert sonst still die falschen Treffer.
- Ein Restore-Drill wurde real durchgeführt und protokolliert
  ([Runbook](docs/runbooks/restore.md)).

---

## Was dabei schiefging

Für ein ehrliches Bild — diese Fälle sind in den ADRs dokumentiert:

**Der Delta-Fetch holte die falschen Papers.** Die arXiv-Suche lautete
`all:retrieval augmented generation` — unquotiert bindet nur das erste Wort ans
Feld. Zusammen mit der Sortierung nach Datum kamen die neuesten Einreichungen
*aller* Disziplinen zurück: 20 von 40 Papers hatten keinerlei Informatik-Kategorie.
Behoben mit quotierter Phrase und Kategorie-Filter, abgesichert durch Tests.

**Mehr Daten machten den Graphen nicht voller.** Nach 56 Papers hatten alle 316
unbestätigten Fakten exakt eine Quelle — die Regel „zwei unabhängige Belege" konnte
nie greifen. Die Ursache war nicht die Korpusgröße, sondern die Benennung: Jedes
Paper prägte eigene Begriffe. Erst kanonische Namen plus ein Vokabular im
Extraktions-Prompt haben das gelöst.

**Ein Indexierungslauf wurde vom OOM-Killer beendet.** Docling lief mit
eingeschalteter OCR über born-digital PDFs — die Stufe lieferte nichts und
verbrauchte den ganzen Speicher. Ohne OCR: viermal schneller, kein Absturz.

---

## Deployment

Der öffentliche Betrieb ist ein schlanker Leseserver — kein Docling, kein torch,
kein lokales Modell. Der Korpus wird lokal gebaut und als Datenbank-Dump
eingespielt.

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
backend/app/   ingestion · retrieval · generation · corpus (Update-Loop) · api · db
frontend/      React-SPA: Chat · Suche · Inbox · Wissen · Skills · Projekte
mcp_server/    MCP-Werkzeuge für Claude Desktop
eval/          Golden-Set, Hit-Rate-Messung, Parameter-Tuning
scripts/       Korpus-Fetch · Reindex · Deploy-Gate · Smoke-Test · Backup
docs/adr/      15 Architecture Decision Records · docs/runbooks/
```

## Lizenz

MIT — siehe [LICENSE](LICENSE). Paper-PDFs unter `data/` sind git-ignoriert und
werden nie committet (arXiv-Lizenz).
