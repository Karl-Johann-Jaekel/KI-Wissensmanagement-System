"""Application settings (pydantic-settings).

One source of truth for config; reads from environment / .env. The DATABASE_URL is
derived from POSTGRES_* parts unless explicitly overridden. The embedding model name
and dimension live here (and in the DB per-chunk) — PLAN §2.3: one model for all.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field, computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Runtime
    app_env: str = "development"
    log_level: str = "INFO"
    # Comma-separated allowed CORS origins (frontend dev servers).
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # Database. Der Pool muss zu Starlettes Threadpool passen (siehe db/session.py):
    # 40 Threads gegen 15 Verbindungen hiess, dass gleichzeitige Chats aufeinander
    # warten, ohne dass es irgendwo auffaellt.
    db_pool_size: int = 20
    db_max_overflow: int = 20
    db_pool_timeout_s: float = 10.0
    postgres_user: str = "kwms"
    postgres_password: str = "kwms"
    postgres_db: str = "kwms"
    postgres_host: str = "postgres"
    postgres_port: int = 5432
    database_url: str | None = None

    # Embeddings (fixed in Phase 3 — see docs/adr/0002; one model for index AND query).
    # provider: "ollama" (lokal, nichts verlässt den Rechner) | "mistral" (EU-API,
    # mistral-embed, ebenfalls 1024 dim) — ADR-0014.
    embed_provider: str = "ollama"
    embed_model: str = "qwen3-embedding:0.6b"
    embed_dim: int = 1024

    # Docling-Parsing. OCR aus: arXiv-PDFs sind born-digital, die OCR-Stufe war der
    # Speicher-Peak, der den Ingest-Prozess bei 40 Papers zerlegt hat (ADR-0011).
    docling_ocr: bool = False
    docling_table_structure: bool = True

    # GROBID (Phase 11.4, ADR-0019). Referenz- und Sektionsparsing für PDFs;
    # der Dienst läuft im Compose-Profil `grobid`, ist aber optional.
    grobid_url: str = "http://grobid:8070"
    grobid_timeout_s: float = 180.0

    # Ollama (confidential zone)
    ollama_base_url: str = "http://ollama:11434"
    ollama_llm_model: str = "qwen3:8b"

    # Reranker (Phase 4)
    rerank_enabled: bool = False
    rerank_model: str = "bge-reranker-v2-m3"

    # Mistral (public zone, Phase 5). Trägt auch die Embeddings (ADR-0014) und ist
    # damit gesetzt, selbst wenn die Antworten von Groq kommen.
    mistral_api_key: str = ""
    mistral_model: str = "mistral-medium-latest"

    # Groq (ADR-0021). Mit Schlüssel antwortet Groq, Mistral wird zur Rückfallebene.
    # Kein Embedding-Endpunkt bei Groq — der Schlüssel wirkt nur auf den Chat.
    groq_api_key: str = ""
    # Die Modellliste je Konto weicht von der Doku ab: llama-3.3-70b ist dort
    # als Produktionsmodell gelistet, auf einem freien Konto aber nicht
    # freigeschaltet (404 model_not_found). Vor dem Aendern gegenpruefen:
    #   curl -H "Authorization: Bearer $GROQ_API_KEY" \
    #        https://api.groq.com/openai/v1/models
    # gpt-oss-120b verbraucht Token fuer internes "reasoning", bevor Inhalt
    # entsteht — bei zu kleinem max_tokens kommt eine leere Antwort zurueck.
    groq_model: str = "openai/gpt-oss-120b"

    # Promotion pending -> verified (Phase 8). Lockern erhöht die Ausbeute, senkt aber
    # die Belegtiefe — Provenienz bleibt in jedem Fall Pflicht (PLAN §2.7, ADR-0010).
    promote_min_sources: int = 2
    promote_confidence: float = 0.7

    # GitHub-Token für scripts/enrich_repo_stars.py. Nur öffentliche Zahlen werden
    # gelesen, ein Token ohne Rechte genügt — ohne Token erlaubt GitHub 60 Abfragen
    # je Stunde, mit Token 5.000.
    github_token: str = ""

    # Zitationsmetriken (ADR-0013). Ohne Key gilt das freie Kontingent von
    # Semantic Scholar; ab dieser Zitationszahl gilt ein Paper als Primärquelle.
    semantic_scholar_api_key: str = ""
    citation_landmark_min: int = 100

    # Hardening (Phase 5)
    admin_api_key: str = "change-me"
    daily_token_cap: int = 200_000
    rate_limit: str = Field(default="30/minute")

    # Schreibwege (Upload, Bearbeiten, Loeschen). Standard aus: die Oberflaeche bietet
    # sie seit dem Redesign nicht mehr an, offen waeren sie nur Angriffsflaeche auf
    # einem oeffentlichen Server. Befuellt wird per `python -m app.ingest` (ADR-0024).
    writes_enabled: bool = False

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @computed_field  # type: ignore[prop-decorator]
    @property
    def sqlalchemy_url(self) -> str:
        if self.database_url:
            return self.database_url
        return (
            f"postgresql+psycopg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
