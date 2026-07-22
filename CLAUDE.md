# Projektkontext: KI-Wissensmanagement-System

DSGVO-konformes RAG-Wissensmanagement über KI-Forschungsartikel + GitHub-Portfolio-
Graph + rekursiver Update-Loop. Vollständiger Plan in [PLAN.md](PLAN.md) — vor jeder
Aufgabe lesen, aktuelle Phase dort abhaken.

## Regeln
- Zonen: `public` (Korpus/GitHub, EU-API erlaubt) vs. `confidential` (nur lokal, Ollama).
- Öffentliches Deployment enthält NIE `confidential`-Daten (Deploy-Gate-Skript).
- Paper-PDFs nie committen (arXiv-Lizenz); nur `demo-data/corpus.yaml` ist im Repo.
- Extrahierte Graph-Fakten starten als `pending`; Promotion nur regelbasiert/Review;
  Provenienz (`source_document_ids`) ist Pflicht; kein Silent-Overwrite.
- Ein multilinguales Embedding-Modell für Index UND Query (siehe `.env`).
- `data/` und `.env` sind tabu für Commits, Logs und Tests. Gitleaks muss grün sein.
- Agent-Tools nur als feste, parametrisierte Funktionen — kein LLM-generiertes SQL.
- Stack: FastAPI, Postgres+pgvector, Ollama, Mistral-API, fastmcp, React+TS, n8n.

## Arbeitsweise
- Phasen strikt nacheinander (PLAN §7). Kein Phasenwechsel vor erfüllter DoD.
- Kleine Commits (Conventional Commits). Abweichungen als ADR in `docs/adr/`.
- Tests zu jedem Feature. `ruff`, `mypy` (loose), `pytest`, `gitleaks` grün halten.

## Entwicklung
- Backend läuft in Docker (Python 3.12). `docker compose up` startet DB + Backend.
- Profile: `local` (+ Ollama), `full` (+ frontend, n8n).
- Tests lokal: `cd backend && pytest`. Lint: `ruff check backend`.
