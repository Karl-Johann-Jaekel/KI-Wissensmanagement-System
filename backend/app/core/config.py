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

    # Database
    postgres_user: str = "kwms"
    postgres_password: str = "kwms"
    postgres_db: str = "kwms"
    postgres_host: str = "postgres"
    postgres_port: int = 5432
    database_url: str | None = None

    # Embeddings (decided end of Phase 3)
    embed_model: str = "multilingual-e5-large"
    embed_dim: int = 1024

    # Ollama (confidential zone)
    ollama_base_url: str = "http://ollama:11434"
    ollama_llm_model: str = "qwen3:8b"

    # Reranker (Phase 4)
    rerank_enabled: bool = False
    rerank_model: str = "bge-reranker-v2-m3"

    # Mistral (public zone, Phase 5)
    mistral_api_key: str = ""
    mistral_model: str = "mistral-medium-latest"

    # GitHub (Phase 1)
    github_token: str = ""
    github_username: str = ""

    # Hardening (Phase 5)
    admin_api_key: str = "change-me"
    daily_token_cap: int = 200_000
    rate_limit: str = Field(default="30/minute")

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
