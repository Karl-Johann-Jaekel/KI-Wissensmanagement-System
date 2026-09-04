# Projektkontext: KI-Wissensmanagement-System

DSGVO-konformes RAG-Wissensmanagement über KI-Forschungsartikel (arXiv) +
Wissens-Graph (Papers ↔ Konzepte ↔ Modelle ↔ Datasets) + rekursiver Update-Loop.
Vollständiger Plan in [PLAN.md](PLAN.md) — vor jeder Aufgabe lesen, aktuelle Phase
dort abhaken. GitHub-Portfolio-Track wurde entfernt (ADR-0004).

**Stand:** Phasen 0–11 fertig bis auf 11.6. **Live unter
https://wissen.jaekel.dev** (56 Papers/6.950 Chunks; Hit@5 0,94; Graph mit 13.271
Knoten aus eigenem Korpus + Papers-with-Code, Serverkappung 2.000 je Antwort).
UI: Sidebar-App mit Chat-Verläufen, Suche, Wissen, Skills, Projekte,
Wabenansicht als Einstieg in `/wissen` (ADR-0025) und Graph-Explorer mit 4 Layouts
(ADR-0016); dunkel, mobile-friendly.
Nicht mehr vorhanden: Review-Oberfläche, MD-Editor, Upload-Panel, Landing-Page,
helles Thema (ADR-0023, ADR-0024).
Offen: Uptime-Monitoring, Restore-Drill auf dem VPS, Multilingual-Embeddings (11.6).

## Regeln
- Korpus ist vollständig öffentlich; die Zwei-Zonen-Idee wanderte in ein eigenes
  Projekt (ADR-0015). Admin-Key schützt Review und pending-Fakten. Die Schreibwege
  (Upload, Bearbeiten, Löschen) sind in Produktion abgeschaltet — `WRITES_ENABLED`
  (ADR-0024); befüllt wird über `python -m app.ingest`.
- Vor jedem Rollout: `scripts/check_prod_ready.py` (Deploy-Gate).
- Paper-PDFs nie committen (arXiv-Lizenz); nur `demo-data/corpus.yaml` ist im Repo.
- Extrahierte Graph-Fakten starten als `pending`; Promotion nur regelbasiert;
  Provenienz ist Pflicht und wird in `entities_extracted` **gezählt** (ADR-0022),
  nicht im JSONB-Feld; kein Silent-Overwrite (Upserts: `app/db/graph.py` — Konflikt
  lässt `status`/`first_seen` unangetastet, vereinigt Quellen und senkt `weight` nie).
- Ein Embedding-Modell für Index UND Query (ADR-0002). Aktuell `mistral-embed`
  (1024-dim, ADR-0014); Wechsel nur per `scripts/reindex.py`. Ein gemischter Index
  liefert still die falschen Treffer — `assert_index_matches_settings` bricht ab.
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
- **`--reload` greift hier nicht:** der Bind-Mount `./backend:/app` liefert unter
  Docker Desktop/Windows keine inotify-Events, der laufende uvicorn behält den alten
  Code. `docker compose exec ... python` startet dagegen einen neuen Prozess und
  zeigt den neuen Stand — das täuscht. Vor jeder Prüfung gegen die laufende API:
  `docker compose restart backend`.
- Frontend: `cd frontend && npm run dev` (http://localhost:5173) bzw. `npm run build`.
- Eval: `docker compose exec backend python eval/run_eval.py`.
- Korpus: `python scripts/fetch_corpus.py` + `python -m app.ingest data/corpus`
  (beides im Container; idempotent).
