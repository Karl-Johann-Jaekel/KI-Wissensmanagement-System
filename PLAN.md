# PLAN.md — KI-Wissensmanagement-System (Ansatz 3, v3)

> Arbeitsgrundlage für Claude Code. Phasen strikt nacheinander abarbeiten.
> Jede Phase endet in einem lauffähigen, getesteten Zustand (Definition of Done).
> Haken (`[x]`) direkt in dieser Datei pflegen.

---

## 1. Ziel & Scope

Projektname: **KI-Wissensmanagement-System** (Repo-Slug: `ki-wissensmanagement-system`).
Zwei Tracks in einem Repo:

**Track A — Portfolio-Graph (zuerst, Recruiter-Fokus):**
Alle eigenen GitHub-Repos werden synchronisiert und als interaktiver Knowledge Graph
visualisiert (Repos ↔ Technologien ↔ Domänen). Recruiter sehen den Tech-Stack auf
einen Blick und können per Agent damit chatten. Nur öffentliche Daten.

**Track B — KI-Forschungskorpus (öffentlich) + privater Lokalbetrieb:**
RAG-Pipeline (PDF → Markdown → Chunks → Embeddings → pgvector → Hybrid Search + RRF
→ Reranking → Antwort mit Zitaten) über **öffentliche wissenschaftliche Artikel zu KI**
(arXiv: RAG-Systeme, Agenten, neue Modelle/Technologien). Darauf aufbauend ein
**Wissens-Graph** (Papers ↔ Konzepte ↔ Modelle ↔ Datasets) und ein **rekursiver
Update-Loop**: neue Publikationen werden automatisch geholt, extrahiert, visuell als
„Neu" hervorgehoben und nach Verifikationsregeln in den Bestand übernommen.
Dieselbe Pipeline läuft lokal mit privaten Dokumenten aus `data/private/`
(git-ignoriert, verlässt nie den eigenen Rechner).

**Nicht-Ziele (vorerst):** Multi-Tenancy, SSO/Keycloak, Berechtigungen pro Chunk,
`internal`-Zone mit PII-Redaktion, Kennzahlen-Dashboards, Slack-/E-Mail-Konnektoren,
vollständiger Zitationsgraph (CITES via Referenz-Parsing).

---

## 2. Leitplanken (gelten in jeder Phase)

1. **Zwei aktive Datenzonen.** `sensitivity ∈ {public, confidential}`
   (Schema kennt zusätzlich `internal` für später, wird im MVP nicht genutzt).
   - `public` → Forschungskorpus + GitHub-Daten; Inferenz via EU-API (Mistral, AVV).
   - `confidential` → private Dokumente; ausschließlich lokale Modelle (Ollama).
2. **Split-Deployment (Privacy by Architecture).** Der öffentliche Server enthält
   **ausschließlich** public-Daten. Private Dokumente existieren nur im lokalen
   Betrieb. Es gibt keinen Sync-Pfad von `data/private/` Richtung Server.
3. **Ein Embedding-Modell für alles.** Index und Query identisch; Modellname +
   Dimension in der DB; Wechsel nur per Reindex-Skript. Muss **multilingual** sein
   (deutsche Fragen auf englischen Korpus).
4. **Keine echten/privaten Daten im Repo.** `data/` ist git-ignoriert. **Gitleaks**
   läuft als pre-commit-Hook und in CI — `.gitignore` allein schützt nicht vor
   versehentlichen Commits.
5. **Urheberrecht Korpus.** Paper-PDFs werden **nie committet** — die arXiv-
   Standardlizenz erlaubt keine Weiterverbreitung durch Dritte (nur CC-BY/CC0-Papers
   dürften das, Einzelfallprüfung lohnt nicht). Committet werden nur Metadaten
   (`demo-data/corpus.yaml`: Themen-Queries + Seed-Paper-IDs); PDFs lädt
   `scripts/fetch_corpus.py` zur Laufzeit nach `data/corpus/` (git-ignoriert).
6. **Zitatpflicht.** Jede RAG-Antwort nennt Quellen (Paper/Dokument + Chunk). Ohne
   belastbare Treffer: „dazu liegt keine Quelle vor" statt Halluzination.
7. **Kein Silent-Overwrite.** LLM-extrahierte Graph-Fakten starten als `pending`;
   Übernahme nach `verified` nur regelbasiert oder per Review. Konflikte mit
   bestehendem Wissen werden markiert, nie automatisch überschrieben. Jeder Fakt
   trägt Provenienz (Quell-Dokumente).
8. **Agent-Tools ohne Freiform-Queries.** Agenten rufen nur fest definierte,
   parametrisierte Funktionen auf (kein LLM-generiertes SQL/Cypher).

---

## 3. Architektur (Zielbild)

```
              ÖFFENTLICHER BETRIEB (EU-VPS, nur public-Zone)
┌────────────────────────────────────────────────────────────────────┐
│ GitHub-Sync ──▶ Portfolio-Graph ──┐                                │
│ arXiv-Fetch ──▶ RAG-Pipeline ──▶ pgvector/tsvector                 │
│                └▶ Extraktion ──▶ Wissens-Graph (pending→verified)  │
│ n8n-Loop: Delta-Fetch ▸ Extraktion ▸ Review ▸ „Neu"-Highlight      │
│ Retrieval: Hybrid ▸ RRF ▸ Reranker ── LLM: Mistral EU-API (AVV)    │
│ FastAPI: /graph /search /chat /portfolio/chat  + MCP-Server        │
└────────────────────────────────────────────────────────────────────┘

              LOKALER BETRIEB (eigener Rechner, private Daten)
┌────────────────────────────────────────────────────────────────────┐
│ data/private/*.pdf ──▶ gleiche Pipeline ──▶ eigene lokale DB       │
│ LLM & Embeddings: Ollama (nichts verlässt den Rechner)             │
└────────────────────────────────────────────────────────────────────┘
```

---

## 4. Tech-Stack (festgelegt)

| Ebene | Wahl | Anmerkung |
|---|---|---|
| Backend | Python 3.12, FastAPI, SQLAlchemy, Alembic, pydantic-settings | |
| Datenbank | PostgreSQL 16 + **pgvector** | Volltext via `tsvector`/GIN, sprachabhängig (en/de) |
| Graph-Speicher | **relationale Tabellen** `graph_nodes`/`graph_edges` | bewusst kein Apache AGE/Neo4j: Graphen bleiben klein; SQL-Traversals reichen; eine Abhängigkeit weniger |
| Graph-Frontend | **react-force-graph** (2D, d3-force) | eine Komponente, zwei Datensätze: Portfolio- und Wissens-Graph |
| Korpus-Quelle | **arXiv API** (cs.AI, cs.CL, cs.IR, cs.LG + Keyword-Queries) | höflich: Rate-Limits beachten, User-Agent setzen |
| OCR / Parsing | **Docling** (lokal, Default) | arXiv-PDFs sind born-digital; Formeln/Tabellen bestmöglich nach Markdown |
| Chunking | Heading-aware Markdown-Split (~1.000 Zeichen, Overlap ~150) | semantisches Chunking nur für überlange Abschnitte |
| Embeddings | lokal via Ollama: `qwen3-embedding` **oder** `multilingual-e5-large` | zwingend multilingual (DE-Fragen ↔ EN-Papers); Benchmark in Phase 3, dann fix |
| Reranker | `bge-reranker-v2-m3` (lokal), **per Env-Flag schaltbar** | multilingual; auf CPU-VPS ggf. deaktivieren |
| LLM public | Mistral Medium/Large (La Plateforme, AVV abschließen) | auch für die Fakten-Extraktion (public-Daten) |
| LLM confidential | Ollama lokal: Qwen3 8B / Mistral Small / Gemma 3 | nur im lokalen Betrieb |
| MCP | `fastmcp` (Python) | Tools s. Phase 7 |
| Frontend | React + TypeScript + Vite + Tailwind, SSE-Streaming | |
| Automatisierung | n8n (Docker), Workflows als JSON in `automation/` | Cron-Loop in Phase 8 |
| Deployment | Docker Compose, Caddy (TLS), EU-VPS (z. B. Hetzner, CPU reicht) | |
| Qualität | pytest, ruff, mypy (loose), gitleaks, GitHub Actions | |

---

## 5. Repo-Struktur

```
ki-wissensmanagement-system/
├── PLAN.md                     # diese Datei
├── CLAUDE.md                   # Kurzanweisung für Claude Code (s. Abschnitt 9)
├── README.md
├── docker-compose.yml          # profiles: public | local (Ollama) | full (n8n)
├── .env.example
├── .gitignore                  # data/, .env, *.pem, n8n-Credentials …
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── api/                # health, graph, ingest, search, chat, portfolio, review
│   │   ├── core/               # config, llm_router, security
│   │   ├── github/             # sync.py, extract.py (Manifeste/Topics → Graph)
│   │   ├── corpus/             # arxiv.py (Fetch/Delta), extract.py (Paper → Fakten)
│   │   ├── ingestion/          # ocr.py, chunking.py, embedding.py, pipeline.py
│   │   ├── retrieval/          # hybrid.py, rrf.py, rerank.py
│   │   ├── generation/         # prompts.py, generate.py, portfolio_agent.py
│   │   └── db/                 # models.py, session.py, migrations/
│   └── tests/
├── mcp_server/
├── frontend/                   # Graph-Seiten + Chat + Review-Queue (eine App)
├── automation/                 # n8n-Exporte (JSON, ohne Credentials)
├── eval/                       # golden.yaml, run_eval.py, tune.py
├── demo-data/
│   └── corpus.yaml             # Themen-Queries + ~15 Seed-Paper-IDs (committet)
├── data/                       # GIT-IGNORIERT
│   ├── corpus/                 # gefetchte arXiv-PDFs
│   └── private/                # eigene Dokumente, nur lokal
├── scripts/                    # fetch_corpus.py, export_graph_json.py,
│                               # reindex.py, check_no_confidential_in_prod.py
└── docs/adr/
```

---

## 6. Datenmodell (Kern)

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE documents (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type   TEXT NOT NULL,           -- arxiv_pdf | github_readme | github_manifest | pdf
    title         TEXT NOT NULL,
    uri           TEXT,                    -- arXiv-URL, Repo-URL, Pfad
    content_hash  TEXT NOT NULL UNIQUE,
    sensitivity   TEXT NOT NULL DEFAULT 'public'
                  CHECK (sensitivity IN ('public','internal','confidential')),
    lang          TEXT NOT NULL DEFAULT 'english',   -- english | german
    meta          JSONB DEFAULT '{}',      -- arXiv-ID, Autoren, published_at, categories
    created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE chunks (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id   UUID REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index   INT NOT NULL,
    content       TEXT NOT NULL,
    lang          TEXT NOT NULL DEFAULT 'english',
    content_tsv   TSVECTOR GENERATED ALWAYS AS (
                    CASE WHEN lang = 'german'
                         THEN to_tsvector('german'::regconfig, content)
                         ELSE to_tsvector('english'::regconfig, content) END
                  ) STORED,
    embedding     VECTOR(1024),            -- Dimension = gewähltes Embedding-Modell!
    embed_model   TEXT NOT NULL,
    meta          JSONB DEFAULT '{}'
);

CREATE INDEX idx_chunks_embedding ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_chunks_tsv       ON chunks USING gin (content_tsv);

-- Graphen (Portfolio + Wissen), relational statt Graph-DB
CREATE TABLE graph_nodes (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind       TEXT NOT NULL CHECK (kind IN
               ('repo','technology','domain','paper','concept','model','dataset')),
    name       TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'verified'
               CHECK (status IN ('pending','verified','rejected')),
    first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
    meta       JSONB DEFAULT '{}',         -- Provenienz: source_document_ids, confidence
    UNIQUE (kind, name)
);

CREATE TABLE graph_edges (
    source     UUID REFERENCES graph_nodes(id) ON DELETE CASCADE,
    target     UUID REFERENCES graph_nodes(id) ON DELETE CASCADE,
    relation   TEXT NOT NULL CHECK (relation IN
               ('USES','BUILT_WITH','RELATED_TO',
                'INTRODUCES','EVALUATES_ON','IMPROVES_ON')),
    status     TEXT NOT NULL DEFAULT 'verified'
               CHECK (status IN ('pending','verified','rejected')),
    first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
    weight     REAL DEFAULT 1.0,
    meta       JSONB DEFAULT '{}',         -- Provenienz: source_document_ids, confidence
    PRIMARY KEY (source, target, relation)
);
```

Autoren bleiben Metadaten am `paper`-Dokument (keine Personen-Knoten im öffentlichen
Graphen). `ON DELETE CASCADE`: Löschung greift bis in Vektor-Index und Graph durch.

---

## 7. Phasenplan

### Phase 0 — Repo & Infrastruktur
- [x] Repo-Struktur aus Abschnitt 5; `.gitignore` (inkl. `data/`), `.env.example`, `CLAUDE.md`
- [x] `docker-compose.yml`: postgres (pgvector-Image), backend; Profile `local` (+ Ollama), `full` (+ frontend, n8n)
- [x] pre-commit: ruff, gitleaks; GitHub Actions: lint + tests
- [x] FastAPI-Skelett mit `GET /health`; Alembic initialisiert
- **DoD:** `docker compose up` startet DB + Backend; `/health` antwortet; CI grün.

### Phase 1 — GitHub-Sync & Portfolio-Graph-Daten  *(Track A)*
- [x] Migration: Schema aus Abschnitt 6
- [x] `github/sync.py`: GitHub-REST-API (PAT, nur public scope) — Repos, Topics,
      Languages (Byte-Anteile → `weight`), READMEs, Manifeste
      (`package.json`, `pyproject.toml`, `requirements.txt`)
- [x] `github/extract.py`: **regelbasiert** Manifeste/Topics → nodes/edges
      (Mapping Dependency→Technologie); Status direkt `verified` (deterministisch)
- [x] READMEs als `public`-Dokumente in `documents` (für RAG in Phase 5)
- [x] `GET /graph?scope=portfolio|knowledge` liefert `{nodes, links}`;
      ETag/Conditional Requests beim Sync (GitHub-Rate-Limits)
- [x] CLI: `python -m app.sync_github <username>` (idempotent)
- **DoD:** Sync füllt Graph reproduzierbar; Unit-Tests fürs Dependency-Mapping.

### Phase 2 — Graph-Visualisierung  *(Track A — erstes öffentliches Deliverable)*
- [ ] React-Seite mit **react-force-graph**: Farbe nach `kind`, Knotengröße nach
      Kantengewicht; Komponente generisch (nimmt später auch den Wissens-Graph)
- [ ] Interaktion: Hover-Highlight der Nachbarn, Filter nach Technologie/Sprache,
      Klick auf Repo → Seitenpanel (Beschreibung, Link, Tech-Liste)
- [ ] `scripts/export_graph_json.py` → statisches `graph.json`
      (Fallback: läuft notfalls ohne Backend auf GitHub Pages)
- **DoD:** Interaktiver Portfolio-Graph im Browser; verlinkbar (README-GIF + Live-Link).

### Phase 3 — KI-Forschungskorpus indexieren  *(Track B; Video-Schritte 1–4)*
- [ ] `demo-data/corpus.yaml`: Themen-Queries (RAG, Retrieval, Agents, Reranking,
      Knowledge Graphs, neue Modelle) + ~15 Seed-Paper-IDs (Klassiker + Aktuelles)
- [ ] `scripts/fetch_corpus.py`: arXiv-API-Fetch nach `data/corpus/` (Metadaten:
      arXiv-ID, Autoren, published_at, Kategorien, Abstract); Rate-Limit-freundlich
- [ ] **Embedding-Benchmark:** 2 Kandidaten × 10 Queries, davon 5 **deutsch** auf
      englische Papers (cross-lingual!); Gewinner in `.env` fixieren, ADR schreiben
- [ ] `ingestion/`: Docling → Markdown; Heading-Chunking (Tests inkl. Tabellen/Formeln);
      Ollama-Embedding mit Batching/Retry; `lang` pro Dokument setzen
- [ ] CLI: `python -m app.ingest data/corpus --sensitivity public`
      bzw. `data/private --sensitivity confidential` (idempotent via `content_hash`)
- **DoD:** Seed-Korpus vollständig indexiert; zweiter Lauf erzeugt keine Duplikate.

### Phase 4 — Retrieval  *(Video-Schritte 5–7)*
- [ ] `retrieval/hybrid.py`: Vektor-Suche (cosine, Top-30) parallel zu BM25/`tsquery`
      (Top-30, Konfig nach `lang`); DE-Fragen auf EN-Korpus tragen primär über die
      multilinguale Vektor-Suche
- [ ] `retrieval/rrf.py`: Reciprocal Rank Fusion
- [ ] `retrieval/rerank.py`: `bge-reranker-v2-m3` → Top-5; Env-Flag `RERANK_ENABLED`
- [ ] `POST /search`: Retrieval mit Scores (Debug), Filter nach `sensitivity`
- [ ] `eval/golden.yaml`: 15 Paare (Frage → erwartetes Paper), gemischt DE/EN;
      `eval/run_eval.py` misst Hit-Rate@5 — mit und ohne Reranker
- **DoD:** Hit-Rate@5 ≥ 0,8; Latenz lokal < 2 s.

### Phase 5 — Generation, Router & Recruiter-Agent  *(Video-Schritt 8 + Track A)*
- [ ] `core/llm_router.py`: höchste Sensitivität der Treffer entscheidet —
      `confidential` ⇒ nur Ollama, nachweislich kein externer Call (Test mit Netz-Mock)
- [ ] `generation/prompts.py`: Nur-Kontext-Regel, Zitatformat `[Paper, Abschnitt]`,
      explizite „weiß nicht"-Regel
- [ ] `POST /chat`: SSE-Streaming; Response enthält `answer` + `sources[]`
- [ ] `generation/portfolio_agent.py` + `POST /portfolio/chat`:
      feste Tool-Funktionen `repos_by_technology(tech)`, `technologies_of(repo)`,
      `related_repos(repo)` + RAG über READMEs; **hart auf Zone `public` beschränkt**
- [ ] Hardening: Rate-Limit (slowapi), tägliches Token-/Kosten-Cap, festes
      Systemprompt, Input-Längenlimit
- **DoD:** Portfolio-Fragen korrekt mit Repo-Links; Fachfragen („Was ist RRF?") mit
  Paper-Beleg; Zonentest belegt keinen Zugriff auf `confidential`.

### Phase 6 — Frontend-Ausbau
- [ ] Eine App: Graph-Seiten + Chat; Recruiter-Modus (public, ohne Login) und
      Admin-Modus (API-Key; lokal auch `confidential`)
- [ ] Quellen-Panel (Chunk-Vorschau, Paper-/Dokument-Link), Dokumentliste mit
      Sensitivity-Badge, Upload nur im Admin-Modus
- **DoD:** Ende-zu-Ende im Browser: Frage → belegte Antwort; Graph ↔ Chat verlinkt.

### Phase 7 — MCP-Server & n8n-Basis
- [ ] `mcp_server/`: fastmcp-Tools `search_knowledge(query, top_k)`,
      `ask_knowledge(question)`, `list_documents(filter)`, `query_graph(scope, …)` —
      alle mit `max_sensitivity`-Parameter (Default `public`)
- [ ] In Claude Code/Desktop einbinden und manuell verifizieren
- [ ] n8n aufsetzen; Workflow: Watch-Folder/Webhook → `/ingest`; Exporte nach `automation/`
- **DoD:** Claude kann via MCP Bestand + Graphen abfragen; neue PDF wird ohne
  manuellen Schritt abfragbar.

### Phase 8 — Living Knowledge: rekursiver Update-Loop  *(Kern-Feature Track B)*
- [ ] `corpus/arxiv.py --since`: Delta-Fetch neuer Papers zu den Queries aus
      `corpus.yaml` (n8n-Cron, z. B. wöchentlich); Cap pro Lauf (max. N Papers)
- [ ] Auto-Ingest der Deltas (Pipeline aus Phase 3)
- [ ] `corpus/extract.py`: LLM extrahiert pro Paper Fakten für den Wissens-Graph
      (Konzepte, Modelle, Datasets, Relationen) mit Konfidenz — **alles startet
      `pending`**, Provenienz (`source_document_ids`) ist Pflichtfeld
- [ ] Konzept-Normalisierung: Alias-Mapping („RAG" = „Retrieval-Augmented Generation"),
      Dedupe vor Insert
- [ ] Promotion-Regeln: auto-`verified` nur bei Konfidenz ≥ Schwelle **und** Stützung
      durch ≥ 2 unabhängige Quellen; sonst Review-Queue im Admin-Frontend
      (verify/reject per Klick); Konflikte mit bestehendem `verified`-Wissen werden
      markiert (`meta.disputed`), nie überschrieben
- [ ] Frontend „Neu"-Layer: Knoten mit `first_seen` < 7/30 Tage pulsieren/leuchten;
      Zeitfilter; Changelog-Feed „Diese Woche neu"; Wissens-Graph-Ansicht
      (gleiche Komponente, `scope=knowledge`; public sieht nur `verified`)
- [ ] Selbstoptimierung **messbar**: nach jedem Lauf Golden-Eval; `eval/tune.py`
      sweept Retrieval-Parameter (top_k, RRF-k, `RERANK_ENABLED`) und übernimmt die
      beste Konfiguration; Report pro Lauf als Artefakt. Keine autonomen
      Codeänderungen — Optimierung heißt Parameter + Datenbestand, nicht Code.
- [ ] Kosten-Cap pro Lauf (Token-Budget für Extraktion)
- **DoD:** Loop läuft end-to-end per Cron; neue Papers erscheinen hervorgehoben;
  kein `verified`-Fakt ohne Quellbeleg (DB-Check); Eval-Report pro Lauf vorhanden.

### Phase 9 — Deployment (öffentlich) & privater Lokalbetrieb
- [ ] **Öffentlich:** EU-VPS (CPU reicht — Inferenz via Mistral-API), Compose-Profil
      `public`, Caddy TLS; öffentlich nur `/graph` + `/portfolio/chat` (+ Chat im
      public-Scope), Rest hinter API-Key; DB frisch aus GitHub-Sync + Korpus-Fetch
- [ ] `scripts/check_no_confidential_in_prod.py` als Deploy-Gate
- [ ] n8n-Cron für den Living-Knowledge-Loop produktiv schalten (inkl. Caps)
- [ ] Backups: nightly `pg_dump` + Volume-Snapshot; **Restore einmal real testen**
- [ ] Logging ohne Chunk-Inhalte; Uptime-Monitoring; Golden-Eval als Prod-Smoke-Test
- [ ] **Lokal:** Profil `local` mit Ollama; `data/private/` ingesten; README-Abschnitt
      „Privater Betrieb"
- **DoD:** Graph, Wissens-Graph und Recruiter-Chat live unter eigener Domain;
  Deploy-Gate grün; Backup-Restore verifiziert.

---

## 8. Änderungsprotokoll

**v2 (Kurzbegründung):**

| Bereich | v1 | v2 | Warum |
|---|---|---|---|
| Reihenfolge | RAG zuerst, Graph in Phase 7 | Graph in Phase 1–2 | schnellstes Recruiter-Deliverable; nur public-Daten |
| Graph-Speicher | Apache AGE | relationale Tabellen + react-force-graph | Graph klein; Wow-Effekt liefert die Visualisierung; weniger Abhängigkeiten |
| Deployment | ein System | Split: öffentlich (public, EU-API) / lokal (Ollama, privat) | kein GPU-Hosting; private Daten architektonisch getrennt |
| Datenzonen | 3 Zonen + Presidio aktiv | MVP: public/confidential | weniger bewegliche Teile; Router auditierbar |

**v3 (Kurzbegründung):**

| Bereich | v2 | v3 | Warum |
|---|---|---|---|
| Name | offen | **KI-Wissensmanagement-System** | festgelegt |
| Demo-Korpus | synthetische QM/PM-PDFs | arXiv-Papers zu KI/RAG (Fetch zur Laufzeit) | thematisch stärker fürs Portfolio; arXiv-Standardlizenz erlaubt keine Redistribution ⇒ nur Metadaten committen |
| Wissens-Graph | nur Portfolio | zusätzlich Papers↔Konzepte↔Modelle↔Datasets | vom Nutzer gewünschtes Kernfeature; Schema um kinds/relations + `status`/`first_seen` erweitert |
| Rekursion | — | Phase 8: Delta-Fetch ▸ Extraktion ▸ pending ▸ Promotion/Review ▸ „Neu"-Highlight | „selbst aktualisierend" konkret und sicher: kein Silent-Overwrite, Provenienzpflicht; „selbst optimierend" = messbares Eval-Tuning, keine autonomen Codeänderungen |
| Sprache | de-only tsvector | `lang`-Spalte (en/de), cross-lingualer Eval | Korpus ist englisch, Fragen oft deutsch |

---

## 9. Arbeiten mit Claude Code

**Sitzungs-Muster:** „Lies PLAN.md. Wir arbeiten an Phase N. Setze die offenen Punkte
um, schreibe Tests, aktualisiere die Haken in PLAN.md."

Regeln: kleine Commits (Conventional Commits) · kein Phasenwechsel vor erfüllter DoD ·
Abweichungen als ADR in `docs/adr/` · niemals Inhalte aus `data/` in Commits,
Logs oder Tests.

**CLAUDE.md** (ins Repo-Root legen):

```markdown
# Projektkontext: KI-Wissensmanagement-System
DSGVO-konformes RAG-Wissensmanagement über KI-Forschungsartikel + GitHub-Portfolio-
Graph + rekursiver Update-Loop. Vollständiger Plan in PLAN.md — vor jeder Aufgabe
lesen, aktuelle Phase dort abhaken.

## Regeln
- Zonen: public (Korpus/GitHub, EU-API erlaubt) vs. confidential (nur lokal, Ollama).
- Öffentliches Deployment enthält NIE confidential-Daten (Deploy-Gate-Skript).
- Paper-PDFs nie committen (arXiv-Lizenz); nur demo-data/corpus.yaml ist im Repo.
- Extrahierte Graph-Fakten starten als pending; Promotion nur regelbasiert/Review;
  Provenienz (source_document_ids) ist Pflicht; kein Silent-Overwrite.
- Ein multilinguales Embedding-Modell für Index UND Query (siehe .env).
- data/ und .env sind tabu für Commits, Logs und Tests. Gitleaks muss grün sein.
- Agent-Tools nur als feste, parametrisierte Funktionen — kein LLM-generiertes SQL.
- Stack: FastAPI, Postgres+pgvector, Ollama, Mistral-API, fastmcp, React+TS, n8n.
```

---

## 10. Vor dem Start entscheiden

| # | Entscheidung | Bis wann |
|---|---|---|
| 1 | ~~Projektname~~ → **KI-Wissensmanagement-System** | erledigt |
| 2 | GitHub-PAT (read-only, public) anlegen | vor Phase 1 |
| 3 | Themen-Queries + Seed-Paper-Liste (`corpus.yaml`) | vor Phase 3 |
| 4 | Embedding-Modell final (cross-lingualer Benchmark) | Ende Phase 3 |
| 5 | Mistral-La-Plateforme-Account + AVV | vor Phase 5 |
| 6 | Cron-Frequenz + Caps für den Update-Loop | vor Phase 8 |
| 7 | Domain für Deployment + Widget | vor Phase 9 |

Lokale Hardware bestimmt nur die Ollama-Modellgröße im Privatbetrieb —
für den öffentlichen Server ist keine GPU nötig.

## 11. Bekannte Risiken

- **Extraktions-Halluzinationen:** deshalb pending/verified-Staging, Provenienzpflicht,
  2-Quellen-Regel und Review-Queue — der Wissens-Graph darf nie ungefilterte
  LLM-Ausgabe sein.
- **Entity-Wildwuchs:** ohne Alias-Normalisierung zerfasert der Graph
  („RAG" vs. „Retrieval-Augmented Generation") — Mapping-Tabelle pflegen.
- **Laufende Kosten des Loops:** Extraktion pro Paper kostet Tokens — Caps pro Lauf
  sind Teil der DoD von Phase 8, nicht optional.
- **Urheberrecht Korpus:** Paper-PDFs nie committen; nur Metadaten + Fetch-Skript.
- **arXiv-/GitHub-Rate-Limits:** Delta-Fetch per Cron, ETag/Conditional Requests.
- **CPU-Latenz Reranker:** `RERANK_ENABLED`-Flag; Eval mit/ohne vergleichen.
- **Missbrauch öffentlicher Endpoints:** Rate-Limit + Kosten-Cap (DoD Phase 5).
- **Leak ins öffentliche Repo:** gitleaks + Review; im Ernstfall `git filter-repo`
  + Secret-Rotation, nicht nur löschen.
