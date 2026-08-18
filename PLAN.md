# PLAN.md — KI-Wissensmanagement-System (Ansatz 3, v3)

> Arbeitsgrundlage für Claude Code. Phasen strikt nacheinander abarbeiten.
> Jede Phase endet in einem lauffähigen, getesteten Zustand (Definition of Done).
> Haken (`[x]`) direkt in dieser Datei pflegen.

---

## 1. Ziel & Scope

Projektname: **KI-Wissensmanagement-System** (Repo-Slug: `ki-wissensmanagement-system`).
Seit v4 ein Track (Track B); Track A wurde entfernt:

**~~Track A — Portfolio-Graph~~ (v4: ENTFERNT, siehe ADR-0004):**
~~Alle eigenen GitHub-Repos werden synchronisiert und als interaktiver Knowledge Graph
visualisiert.~~ Der GitHub-Portfolio-Track wurde nach Phase 6 komplett entfernt;
das Projekt fokussiert auf Track B. Phasen 1–2 unten sind erledigte Historie,
ihre Deliverables sind stillgelegt (Code in Git-History erhalten).

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
   - `public` → Forschungskorpus; Inferenz via EU-API (Mistral, AVV).
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
│ arXiv-Fetch ──▶ RAG-Pipeline ──▶ pgvector/tsvector                 │
│                └▶ Extraktion ──▶ Wissens-Graph (pending→verified)  │
│ n8n-Loop: Delta-Fetch ▸ Extraktion ▸ Review ▸ „Neu"-Highlight      │
│ Retrieval: Hybrid ▸ RRF ▸ Reranker ── LLM: Mistral EU-API (AVV)    │
│ FastAPI: /graph /search /chat /documents  + MCP-Server             │
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
| Graph-Frontend | **react-force-graph** (2D, d3-force) | eine generische Komponente für den Wissens-Graph |
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
│   │   ├── ingest.py           # CLI: python -m app.ingest <pfad> --sensitivity …
│   │   ├── api/                # health, graph, search, chat, documents (+ review, Ph. 8)
│   │   ├── core/               # config, llm_router, security
│   │   ├── corpus/             # arxiv.py (Fetch/Delta), extract.py (Paper → Fakten) — Ph. 8
│   │   ├── ingestion/          # ocr.py, chunking.py, embedding.py, pipeline.py
│   │   ├── retrieval/          # hybrid.py, rrf.py, rerank.py, search.py
│   │   ├── generation/         # llm.py, prompts.py, generate.py
│   │   └── db/                 # models.py, session.py, graph.py (Upserts), migrations/
│   └── tests/
├── mcp_server/
├── frontend/                   # Wissens-Graph + Chat + Dokumente (+ Review-Queue, Ph. 8)
├── automation/                 # n8n-Exporte (JSON, ohne Credentials)
├── eval/                       # golden.yaml, run_eval.py, tune.py
├── demo-data/
│   └── corpus.yaml             # Themen-Queries + ~15 Seed-Paper-IDs (committet)
├── data/                       # GIT-IGNORIERT
│   ├── corpus/                 # gefetchte arXiv-PDFs
│   └── private/                # eigene Dokumente, nur lokal
├── scripts/                    # fetch_corpus.py, export_graph_json.py,
│                               # reindex.py, check_prod_ready.py
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

-- Wissens-Graph, relational statt Graph-DB
-- (kinds repo/technology/domain seit v4 ungenutzt, Schema unverändert — ADR-0004)
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

### Phase 1 — GitHub-Sync & Portfolio-Graph-Daten  *(Track A — v4: ENTFERNT, ADR-0004)*
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

### Phase 2 — Graph-Visualisierung  *(v4: Portfolio-Ansicht entfernt; die generische Force-Graph-Komponente lebt als Wissens-Graph-View weiter)*
- [x] React-Seite mit **react-force-graph**: Farbe nach `kind`, Knotengröße nach
      Kantengewicht; Komponente generisch (nimmt später auch den Wissens-Graph)
- [x] Interaktion: Hover-Highlight der Nachbarn, Filter nach Technologie/Sprache,
      Klick auf Repo → Seitenpanel (Beschreibung, Link, Tech-Liste)
- [x] `scripts/export_graph_json.py` → statisches `graph.json`
      (Fallback: läuft notfalls ohne Backend auf GitHub Pages)
- **DoD:** ~~Interaktiver Portfolio-Graph im Browser~~ (v4: Ansicht dient jetzt dem
  Wissens-Graph; füllt sich mit Phase 8).

### Phase 3 — KI-Forschungskorpus indexieren  *(Track B; Video-Schritte 1–4)*
- [x] `demo-data/corpus.yaml`: Themen-Queries (RAG, Retrieval, Agents, Reranking,
      Knowledge Graphs, neue Modelle) + ~15 Seed-Paper-IDs (Klassiker + Aktuelles)
- [x] `scripts/fetch_corpus.py`: arXiv-API-Fetch nach `data/corpus/` (Metadaten:
      arXiv-ID, Autoren, published_at, Kategorien, Abstract); Rate-Limit-freundlich
- [x] **Embedding-Benchmark:** ~~2 Kandidaten × 10 Queries~~ → pragmatisch
      `qwen3-embedding:0.6b` fixiert (ADR-0002); voller Benchmark auf Phase 4 vertagt
- [x] `ingestion/`: Docling → Markdown; Heading-Chunking (Tests inkl. Tabellen/Formeln);
      Ollama-Embedding mit Batching/Retry; `lang` pro Dokument setzen
- [x] CLI: `python -m app.ingest data/corpus --sensitivity public`
      bzw. `data/private --sensitivity confidential` (idempotent via `content_hash`)
- **DoD:** Seed-Korpus vollständig indexiert; zweiter Lauf erzeugt keine Duplikate.

### Phase 4 — Retrieval  *(Video-Schritte 5–7)*
- [x] `retrieval/hybrid.py`: Vektor-Suche (cosine, Top-30) parallel zu BM25/`tsquery`
      (Top-30, Konfig nach `lang`); DE-Fragen auf EN-Korpus tragen primär über die
      multilinguale Vektor-Suche
- [x] `retrieval/rrf.py`: Reciprocal Rank Fusion
- [x] `retrieval/rerank.py`: `bge-reranker-v2-m3` → Top-5; Env-Flag `RERANK_ENABLED`
- [x] `POST /search`: Retrieval mit Scores (Debug), Filter nach `sensitivity`
- [x] `eval/golden.yaml`: 16 Paare (Frage → erwartetes Paper), gemischt DE/EN;
      `eval/run_eval.py` misst Hit-Rate@5 — mit und ohne Reranker
- **DoD:** Hit-Rate@5 ≥ 0,8; Latenz lokal < 2 s. → **0,94 (15/16), p95 221ms** ✓

### Phase 5 — Generation & Router  *(v4: Recruiter-Agent/`/portfolio/chat` entfernt)*
- [x] `core/llm_router.py`: höchste Sensitivität der Treffer entscheidet —
      `confidential` ⇒ nur Ollama, nachweislich kein externer Call (Test mit Netz-Mock)
- [x] `generation/prompts.py`: Nur-Kontext-Regel, Zitatformat `[Paper, Abschnitt]`,
      explizite „weiß nicht"-Regel
- [x] `POST /chat`: SSE-Streaming; Response enthält `answer` + `sources[]`
- [x] ~~`generation/portfolio_agent.py` + `POST /portfolio/chat`~~ (v4: entfernt)
- [x] Hardening: Rate-Limit (~~slowapi~~ in-process, ADR-0003), tägliches
      Token-/Kosten-Cap, festes Systemprompt, Input-Längenlimit
- **DoD:** Fachfragen („Was ist RRF?") mit Paper-Beleg; Zonentest belegt keinen
  Zugriff auf `confidential`. ~~Portfolio-Fragen mit Repo-Links~~ (v4)

### Phase 6 — Frontend-Ausbau
- [x] Eine App: Wissens-Graph + Chat + Dokumente; Öffentlich-Modus (ohne Login) und
      Admin-Modus (API-Key; lokal auch `confidential`)
- [x] Quellen-Panel (Chunk-Vorschau, Paper-/Dokument-Link), Dokumentliste mit
      Sensitivity-Badge, Upload nur im Admin-Modus
- **DoD:** Ende-zu-Ende im Browser: Frage → belegte Antwort mit Quellen-Panel.

### Phase 7 — MCP-Server & n8n-Basis
- [x] `mcp_server/`: fastmcp-Tools `search_knowledge(query, top_k)`,
      `ask_knowledge(question)`, `list_documents(filter)`, `query_graph(include_pending)` —
      alle mit `max_sensitivity`/Admin-Gate (Default `public`); HTTP-Wrapper über die
      Backend-API, mit Mock-Tests
- [x] In Claude Code/Desktop einbinden und manuell verifizieren
      (Config-Snippet in `mcp_server/README.md`; Client live gegen echte API geprüft)
- [x] n8n aufsetzen; Workflow: Webhook → `/ingest`; Export in `automation/`
- **DoD:** Claude kann via MCP Bestand + Graphen abfragen; neue PDF wird ohne
  manuellen Schritt abfragbar. → MCP-Client live (search/ask/list/graph) ✓; n8n
  live (:5678); `/ingest`-Pfad per Webhook. Desktop-Einbindung = manueller Nutzerschritt.

### Phase 8 — Living Knowledge: rekursiver Update-Loop  *(Kern-Feature Track B)*
- [x] `corpus/arxiv.py --since`: Delta-Fetch neuer Papers zu den Queries aus
      `corpus.yaml`; Cap pro Lauf (max. N Papers)
- [x] Auto-Ingest der Deltas (Pipeline aus Phase 3; im Orchestrator `app.update`)
- [x] `corpus/extract.py`: LLM extrahiert pro Paper Fakten für den Wissens-Graph
      (Konzepte, Modelle, Datasets, Relationen) mit Konfidenz — **alles startet
      `pending`**, Provenienz (`source_document_ids`) ist Pflichtfeld
- [x] Konzept-Normalisierung: Alias-Mapping („RAG" = „Retrieval-Augmented Generation"),
      Dedupe vor Insert (`corpus/aliases.py`)
- [x] Promotion-Regeln: auto-`verified` nur bei Konfidenz ≥ Schwelle **und** Stützung
      durch ≥ 2 unabhängige Quellen; sonst Review-Queue im Admin-Frontend
      (verify/reject per Klick); Konflikte (reziprokes `IMPROVES_ON`) werden
      markiert (`meta.disputed`), nie überschrieben
- [x] Frontend „Neu"-Layer: Knoten mit `first_seen` < 7/30 Tage leuchten;
      Zeitfilter; Changelog-Feed „Neu (7 Tage)"; Wissens-Graph-Ansicht
      (public sieht nur `verified`, Admin-Toggle für `pending`)
- [x] Selbstoptimierung **messbar**: nach jedem Lauf Golden-Eval (Report-Artefakt);
      `eval/tune.py` sweept Retrieval-Parameter (candidate_k, `RERANK_ENABLED`),
      schreibt beste Konfiguration als Report. Keine autonomen Codeänderungen.
- [x] Kosten-Cap pro Lauf (Token-Budget für Extraktion, `--token-budget`)
- **DoD:** Loop läuft end-to-end (`python -m app.update`, n8n-Cron-fähig); neue Papers
  erscheinen hervorgehoben; kein `verified`-Fakt ohne Quellbeleg (Provenienz aus Kanten);
  Eval-Report pro Lauf. → **live: 16 Papers → 66 Fakten, 3 auto-verified, Eval 0,94** ✓

### Phase 9 — UI/UX-Redesign & Backend-Erweiterung  *(v5: RelationFlow-Vorbild, Branch UI-UX)*
- [x] **9a Design-Foundation:** Tailwind-Tokens (Primär-Blau `#3b82f6` passend zum
      App-Icon, CSS-Var-Flächen,
      hell = Default + Dark-Toggle), UI-Primitives (Button/Card/Modal/Toast/…),
      neue Deps (Router, lucide, react-markdown, vitest) — ADR-0005
- [x] **9a App-Shell:** Sidebar-Layout (Neuer Chat, Suche, Inbox, Wissen, Skills,
      Bibliothek, Projekte, Aktuelle Chats), react-router-Deep-Links, Mobile-Drawer,
      Admin-Key-Modal im Footer; stale `graph.json`-Fallback entfernt
- [x] **9b Client-Datenschicht:** versionierter localStorage-Layer `kwms.v1.*`
      (Chats/Skills/Projekte, Caps + Quota-Handling, `useSyncExternalStore`) — ADR-0006
- [x] **9b Chat:** persistierte Konversationen („Aktuelle Chats", Umbenennen/Löschen),
      Markdown-Antworten, Auto-Grow-Input, Skill-Einfügung, Modell-Select
- [x] **9c Backend:** `documents.content_md` (Migration 0002) + `GET /documents/{id}`
      (stored/reassembled) — ADR-0007; Markdown-Ingest ohne Docling;
      `PUT /documents/{id}/content` (Re-Ingest) + `DELETE /documents/{id}`;
      `GET /models` + Chat-Modell-Override (nur Ollama, admin-gated) — ADR-0008;
      Fix: `include_pending` verlangt jetzt Admin
- [x] **9d Feature-Seiten:** Wissen (Liste/Upload/Reader/MD-Editor + theme-aware Graph),
      Bibliothek (confidential + Ollama-Modellwahl), Inbox (Review + Changelog),
      Suche (`POST /search`-UI mit Score-Balken), Skills, Projekte
- [x] **9d Qualität:** Frontend-CI-Job (vitest + build), 14 Frontend-Tests,
      76 Backend-Tests, Mobile-Pass (Drawer, Karten-Listen, Bottom-Sheet)
- **DoD:** Alle Bereiche im Browser erreichbar (Desktop + Mobile), Checks grün. ✓

### Phase 10 — Deployment (öffentlich) & privater Lokalbetrieb  *(übernimmt alte Phase 9)*
- [x] Compose-Profil `public`: Multi-Stage-Frontend-Image, **Caddy** (TLS via
      `SITE_ADDRESS`, statische SPA, `/api`-Reverse-Proxy) + `docker-compose.prod.yml`
      (kein reload/Bind-Mounts/Host-Ports) — ADR-0009
- [x] `scripts/check_prod_ready.py` als Deploy-Gate (Bestand + Env-Checks, getestet)
- [x] `scripts/smoke_prod.sh`: Health, Graph, public-Chat, Golden-Eval
- [x] Backups: `scripts/backup.sh` (nightly `pg_dump -Fc`, 14-Tage-Rotation);
      **Restore real getestet** (2026-08-03, Protokoll in `docs/runbooks/restore.md`)
- [x] Logging-Audit: keine Chunk-Inhalte in Request-Logs
- [x] Living-Knowledge-Cron produktionsfertig dokumentiert (Host-Cron empfohlen,
      n8n-Alternative im `full`-Profil) — ADR-0009
- [x] **Lokal:** README-Abschnitte „Privater Betrieb" (Bibliothek, Modellwahl) und
      „Öffentliches Deployment" (Schritt-für-Schritt)
- [ ] **Go-Live EU-VPS:** Domain + `.env` produktiv, Stack hochfahren, Gate + Smoke
      auf dem VPS grün, Uptime-Monitoring auf `/api/health`, Prod-Cron aktivieren,
      Restore-Drill auf dem VPS wiederholen
- **DoD:** Wissens-Graph und Chat live unter eigener Domain;
  Deploy-Gate grün; Backup-Restore verifiziert.

### Phase 11 — Fremdquellen & Provenienz  *(v6: Ausbau zur Wissensdatenbank)*

Ausgangslage: Es gibt keine etablierte globale Wissensdatenbank zur KI-Forschung,
die Souveränität **und** Provenienz **und** rekursive Updates abdeckt. Vier
Teillandschaften existieren — bibliografische Substrate (OpenAlex, Semantic
Scholar, Crossref), semantische aber schmale Systeme (ORKG, AI-KG), fragmentierte
KI-Werkzeuge (Epoch AI, AI Index) und eingestellte Vorgänger (Microsoft Academic
Graph, Papers with Code). Differenzierung dieses Systems ist **nicht Abdeckung**
(dagegen verliert man gegen OpenAlex), sondern Souveränität, DSGVO-Konformität,
Konfliktmarkierung im Update-Loop, deutschsprachiger Zugriff auf englischen
Korpus und Tiefe in ausgewählten Teilgebieten.

Lizenz- und DSGVO-Leitplanken für alle Schritte:
- Volltext-Chunks nur aus CC-lizenzierten Quellen (ACL Anthology, CC-arXiv).
- Abstracts aus arXiv/OpenReview/Semantic Scholar nur als invertierter Index,
  nicht als Rohtext. (Papers with Code ist CC-BY-SA — dort sind Abstracts erlaubt.)
- Keine E-Mail-Adressen harvesten, keine Cross-Source-Anreicherung auf
  Autor:innen-Ebene.
- `fetched_at`, `fetched_by`, `source_url` an jedem Datensatz — Grundlage für
  spätere Löschanfragen.
- Repo öffentlich: Code, Konfiguration, ID-Manifeste. Volltexte und Chunk-Tabellen
  bleiben lokal.

- [x] **11.1 Papers-with-Code-Adapter:** Dump (JSON/JSON.gz) → Papers, Code-Repos,
      Datensätze, Tasks, Modelle; Kanten `IMPLEMENTS`, `USES_DATASET`,
      `ACHIEVES_SOTA` (+ `RELATED_TO`, `USES`, `INTRODUCES`). Migration `0004`
      erweitert die CHECKs; `--limit`/`--match` schneiden die Teilmenge zu;
      `--ingest-abstracts` schreibt nach pgvector — ADR-0017
- [ ] **11.2 Graph-Visualisierung der Fremdquelle:** neue Knotenarten und
      Quellenfilter im bestehenden Force-Graph-Explorer
- [ ] **11.3 Harvester-Grundgerüst:** arXiv (OAI-PMH, Delta über `updated_date`)
      und OpenReview API v2 — Rate-Limiting, Backoff, Dedupe (DOI + Titel-Hash),
      Fehlerbehandlung, inkrementeller Zustand
- [ ] **11.4 GROBID:** Docker-Service + Pipeline PDF → TEI-XML → Struktur
      (Titel, Autoren, Sektionen, Referenzen)
- [ ] **11.5 Provenienz-Schema:** Migration für `document_sources` und
      `entities_extracted`, Autor:innen-Entitäten ohne E-Mail-Felder,
      Konflikt-Flags
- [ ] **11.6 Multilingual-Embeddings:** BGE-M3 vs. mBERT vs. LaBSE gegen deutsche
      Fragen auf englischem Korpus; Eval-Report
- **DoD:** Fremdquellen sind importierbar, im Graphen als solche erkennbar und
  vollständig mit Provenienz belegt; Harvester laufen inkrementell; Eval-Report
  liegt vor.

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

**v4 (Kurzbegründung):**

| Bereich | v3 | v4 | Warum |
|---|---|---|---|
| Track A (GitHub-Portfolio) | Portfolio-Graph + Recruiter-Agent (Phasen 1–2, Teile 5–6) | **komplett entfernt** (ADR-0004) | Fokus auf Track B; GitHub-Sync, `/portfolio/chat`, Portfolio-UI und -Daten gelöscht; generische Graph-Infrastruktur (Schema, Force-Graph-UI, Upserts in `app/db/graph.py`) bleibt für den Wissens-Graph (Phase 8) |

---

## 9. Arbeiten mit Claude Code

**Sitzungs-Muster:** „Lies PLAN.md. Wir arbeiten an Phase N. Setze die offenen Punkte
um, schreibe Tests, aktualisiere die Haken in PLAN.md."

Regeln: kleine Commits (Conventional Commits) · kein Phasenwechsel vor erfüllter DoD ·
Abweichungen als ADR in `docs/adr/` · niemals Inhalte aus `data/` in Commits,
Logs oder Tests.

**CLAUDE.md** liegt im Repo-Root und ist die maßgebliche Kurzanweisung
(dieser Abschnitt hält keine Kopie mehr vor — Single Source of Truth).

---

## 10. Vor dem Start entscheiden

| # | Entscheidung | Bis wann |
|---|---|---|
| 1 | ~~Projektname~~ → **KI-Wissensmanagement-System** | erledigt |
| 2 | ~~GitHub-PAT anlegen~~ | obsolet (v4: Track A entfernt) |
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
- **arXiv-Rate-Limits:** Delta-Fetch per Cron, höflich (Delay + User-Agent).
- **CPU-Latenz Reranker:** `RERANK_ENABLED`-Flag; Eval mit/ohne vergleichen.
- **Missbrauch öffentlicher Endpoints:** Rate-Limit + Kosten-Cap (DoD Phase 5).
- **Leak ins öffentliche Repo:** gitleaks + Review; im Ernstfall `git filter-repo`
  + Secret-Rotation, nicht nur löschen.


---

## Nachtrag (Phase 9/10, Stand 2026-08-10)

Abweichungen vom ursprünglichen Plan, jeweils als ADR begründet:

- **Graph-Explorer** (ADR-0016): vier Layouts (Cloud, Globus, Ring, Ebenen),
  räumlich getrennte Wissenswelten mit Farbcodierung, Kanten erst bei Hover,
  verschiebbares Menü mit Suche/Reglern/Kollabieren, Minimap und Leseansicht
  neben dem Graphen. Themen-Cluster = Zusammenhangskomponenten (der Korpus
  zerfällt real in ~48 Inseln).
- **Zwei-Zonen-Architektur entfernt** (ADR-0015). Der Korpus ist vollständig
  öffentlich; die Idee der vertraulichen Zone mit lokalem Modellzwang wird als
  eigenständiges Projekt umgesetzt. Damit entfallen `documents.sensitivity`,
  `max_sensitivity`, `GET /models`, das Modell-Override und die Bibliothek-Seite.
- **Embeddings über die Mistral EU-API** (ADR-0014), damit ein kleiner VPS ohne
  Ollama auskommt. Hit-Rate stieg dabei von 0,88 auf 0,94.
- **Zitationsmetriken** von Semantic Scholar als Qualitätssignal (ADR-0013).
- **Kanonische Entitätsnamen** in der Extraktion (ADR-0012) — die Zwei-Quellen-
  Regel scheiterte zuvor an uneinheitlicher Benennung, nicht an der Korpusgröße.
- **Sammelfreigabe** in der Review-Queue plus konfigurierbare Promotion-Schwellen
  (ADR-0010).
- **Docling ohne OCR** (ADR-0011) nach einem OOM-Abbruch bei 40 Papers.
