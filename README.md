# KI-Wissensmanagement-System

DSGVO-konformes RAG-Wissensmanagement über **KI-Forschungsartikel (arXiv)** mit
**Wissens-Graph** (Papers ↔ Konzepte ↔ Modelle ↔ Datasets) und einem **rekursiven
Update-Loop**, der neue Publikationen automatisch holt, extrahiert und — nach
Verifikation — in den Bestand übernimmt.

Zwei Datenzonen, architektonisch getrennt (Privacy by Architecture):

- **public** — Forschungskorpus; Inferenz via EU-API (Mistral, AVV) oder lokal.
- **confidential** — private Dokumente aus `data/private/`; ausschließlich lokal
  (Ollama), verlässt nie den eigenen Rechner.

Der vollständige Plan steht in **[PLAN.md](PLAN.md)**; Kurzregeln in
**[CLAUDE.md](CLAUDE.md)**. Aktueller Stand: **Phase 6** abgeschlossen
(Chat-UI, Dokumente, Admin-Modus); der GitHub-Portfolio-Track wurde entfernt
(ADR-0004).

## Stack
FastAPI · PostgreSQL 16 + pgvector · Docling · Ollama · Mistral-API · fastmcp ·
React + TS · n8n.

## Quickstart

```bash
cp .env.example .env          # Werte anpassen (mind. POSTGRES_PASSWORD, ADMIN_API_KEY)

docker compose up -d          # postgres + backend  ->  http://localhost:8000/health
docker compose exec backend alembic upgrade head

# Korpus holen + indexieren (Ollama mit EMBED_MODEL muss laufen):
docker compose exec backend python scripts/fetch_corpus.py
docker compose exec backend python -m app.ingest data/corpus --sensitivity public

# Frontend:
cd frontend && npm install && npm run dev    # http://localhost:5173
```

Endpoints: `POST /chat` (zitierte Antworten, SSE) · `POST /search` (Hybrid-Retrieval
mit Scores) · `GET /graph` (Wissens-Graph) · `GET /documents` · `POST /ingest`
(Admin-Upload) · Swagger unter `/docs`.

## Privater Betrieb (confidential)

```bash
# Eigene PDFs nach data/private/ legen, dann:
docker compose exec backend python -m app.ingest data/private --sensitivity confidential
```

Fragen mit `max_sensitivity=confidential` (Admin-Key nötig) werden **garantiert nur
vom lokalen Ollama-Modell** beantwortet — kein externer API-Call (Zonen-Router,
per Test belegt).

## Eval

```bash
docker compose exec backend python eval/run_eval.py        # Hit-Rate@5 + Latenz
```

## Entwicklung

```bash
cd backend
pip install -e ".[dev]"
ruff check . && ruff format --check .
mypy app
pytest
```

Pre-commit (ruff + gitleaks) einmalig aktivieren: `pip install pre-commit && pre-commit install`

## Lizenz
MIT — siehe [LICENSE](LICENSE). Paper-PDFs und private Daten unter `data/` sind
git-ignoriert und werden **nie** committet (siehe PLAN §2).
