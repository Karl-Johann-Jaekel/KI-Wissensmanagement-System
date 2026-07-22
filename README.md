# KI-Wissensmanagement-System

DSGVO-konformes RAG-Wissensmanagement über **KI-Forschungsartikel (arXiv)** plus ein
interaktiver **GitHub-Portfolio-Graph** und ein **rekursiver Update-Loop**, der neue
Publikationen automatisch holt, extrahiert und — nach Verifikation — in einen
Wissens-Graphen übernimmt.

Zwei Datenzonen, architektonisch getrennt (Privacy by Architecture):

- **public** — Forschungskorpus + GitHub-Daten; Inferenz via EU-API (Mistral, AVV).
- **confidential** — private Dokumente aus `data/private/`; ausschließlich lokal (Ollama),
  verlässt nie den eigenen Rechner.

Der vollständige Plan steht in **[PLAN.md](PLAN.md)**; Kurzregeln in
**[CLAUDE.md](CLAUDE.md)**. Aktueller Stand: **Phase 0** (Infrastruktur).

## Stack
FastAPI · PostgreSQL 16 + pgvector · Ollama · Mistral-API · fastmcp · React + TS · n8n.

## Quickstart

```bash
cp .env.example .env          # Werte anpassen (mind. POSTGRES_PASSWORD)

docker compose up             # postgres + backend  ->  http://localhost:8000/health
docker compose --profile local up   # + Ollama (confidential zone)
docker compose --profile full  up   # + frontend + n8n
```

Health-Check:

```bash
curl localhost:8000/health        # {"status":"ok","version":"0.1.0"}
curl localhost:8000/health/db     # {"status":"ok","db":"reachable"}
```

## Entwicklung

```bash
cd backend
pip install -e ".[dev]"
ruff check . && ruff format --check .
mypy app
pytest
```

Datenbank-Migrationen (Alembic, ab Phase 1):

```bash
cd backend
alembic upgrade head
alembic revision -m "beschreibung"    # neue Migration
```

Pre-commit (ruff + gitleaks) einmalig aktivieren:

```bash
pip install pre-commit && pre-commit install
```

## Lizenz
MIT — siehe [LICENSE](LICENSE). Paper-PDFs und private Daten unter `data/` sind
git-ignoriert und werden **nie** committet (siehe PLAN §2).
