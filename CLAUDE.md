# Projektkontext: KI-Wissensmanagement-System

DSGVO-konformes RAG-Wissensmanagement über KI-Forschungsartikel (arXiv) +
Wissens-Graph (Papers ↔ Konzepte ↔ Modelle ↔ Datasets) + rekursiver Update-Loop.
Vollständiger Plan in [PLAN.md](PLAN.md) — vor jeder Aufgabe lesen, aktuelle Phase
dort abhaken. GitHub-Portfolio-Track wurde entfernt (ADR-0004).

**Stand:** Phasen 0–6 fertig (Korpus indexiert: 16 Papers/1801 Chunks; Hybrid-Retrieval
Hit@5 0,94; `/chat` mit Zitaten; Frontend mit Chat/Graph/Dokumenten/Admin-Modus).
Offen: Phase 7 (MCP + n8n), Phase 8 (Living-Knowledge-Loop), Phase 9 (Deployment).

## Regeln
- Zonen: `public` (Korpus, EU-API erlaubt) vs. `confidential` (nur lokal, Ollama).
  Router: nicht-public ⇒ **nur** Ollama; `max_sensitivity != public` nur mit Admin-Key.
- Öffentliches Deployment enthält NIE `confidential`-Daten (Deploy-Gate-Skript, Ph. 9).
- Paper-PDFs nie committen (arXiv-Lizenz); nur `demo-data/corpus.yaml` ist im Repo.
- Extrahierte Graph-Fakten starten als `pending`; Promotion nur regelbasiert/Review;
  Provenienz (`source_document_ids`) ist Pflicht; kein Silent-Overwrite
  (Upserts: `app/db/graph.py` — Konflikt lässt `status`/`first_seen` unangetastet).
- Ein multilinguales Embedding-Modell für Index UND Query:
  `qwen3-embedding:0.6b`, 1024-dim (ADR-0002); Wechsel nur per Reindex.
- `data/` und `.env` sind tabu für Commits, Logs und Tests. Gitleaks muss grün sein.
- Agent-Tools nur als feste, parametrisierte Funktionen — kein LLM-generiertes SQL.
- Stack: FastAPI, Postgres+pgvector, Docling, Ollama, Mistral-API, fastmcp,
  React+TS+Vite+Tailwind, n8n.

## Arbeitsweise
- Phasen strikt nacheinander (PLAN §7). Kein Phasenwechsel vor erfüllter DoD.
- Kleine Commits (Conventional Commits). Abweichungen als ADR in `docs/adr/`.
- Tests zu jedem Feature. `ruff`, `mypy` (loose), `pytest`, `gitleaks` grün halten.

## Entwicklung
- Backend läuft in Docker (Python 3.12). `docker compose up -d` startet DB + Backend
  (Postgres-Hostport via `POSTGRES_HOST_PORT` in `.env`, lokal 5433).
- Ollama läuft auf dem Host; Container erreicht es via `host.docker.internal:11434`.
- Profile: `local` (+ Ollama-Container statt Host), `full` (+ frontend, n8n).
- Checks laufen **im Container**:
  `docker compose exec backend sh -c "ruff check . && ruff format --check . && mypy app && pytest"`.
- Frontend: `cd frontend && npm run dev` (http://localhost:5173) bzw. `npm run build`.
- Eval: `docker compose exec backend python eval/run_eval.py`.
- Korpus: `python scripts/fetch_corpus.py` + `python -m app.ingest data/corpus
  --sensitivity public` (beides im Container; idempotent).
