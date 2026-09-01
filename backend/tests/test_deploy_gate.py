"""Deploy-Gate-Checks (scripts/check_prod_ready.py, Phase 10)."""

from __future__ import annotations

import importlib.util
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import Chunk, Document

# Skript liegt außerhalb des app-Pakets — per Pfad importieren. Layouts:
# Container: /app/tests + /app/scripts (Mount) · CI/Host: backend/tests + ../scripts
_CANDIDATES = [
    parent / "scripts" / "check_prod_ready.py" for parent in Path(__file__).resolve().parents[1:3]
]
_SCRIPT = next(p for p in _CANDIDATES if p.exists())
_SPEC = importlib.util.spec_from_file_location("check_gate", _SCRIPT)
assert _SPEC and _SPEC.loader
gate = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(gate)

PROD_SETTINGS = Settings(
    app_env="production",
    admin_api_key="x" * 32,
    mistral_api_key="sk-prod",
    cors_origins="https://wissen.example.com",
    embed_provider="mistral",
    writes_enabled=False,
)


def _results(checks: list[tuple[str, bool, str]]) -> dict[str, bool]:
    return {name: ok for name, ok, _ in checks}


def test_gate_green_with_ready_environment(db_session: Session) -> None:
    # Das Gate zählt Dokumente *und* Chunks — ein Dokument allein hält es rot.
    # Ohne den Chunk lief der Test nur auf einer bereits befüllten Datenbank grün.
    doc = Document(source_type="pdf", title="P", content_hash="gate-doc")
    db_session.add(doc)
    db_session.flush()
    db_session.add(
        Chunk(
            document_id=doc.id,
            chunk_index=0,
            content="Inhalt",
            embed_model=PROD_SETTINGS.embed_model,
        )
    )
    db_session.commit()
    results = _results(gate.run_checks(settings=PROD_SETTINGS, session=db_session))
    assert results["DB: Korpus ist befüllt"] is True
    assert results["Env: APP_ENV=production"] is True
    assert results["Env: MISTRAL_API_KEY gesetzt (Embeddings via EU-API)"] is True
    assert results["Env: Chat-Anbieter konfiguriert (Groq und/oder Mistral)"] is True
    assert results["Env: CORS ohne localhost"] is True
    assert results["Env: EMBED_PROVIDER kommt ohne lokales Modell aus"] is True
    assert results["Env: Schreibrouten abgeschaltet (WRITES_ENABLED=false)"] is True


def test_gate_red_with_writes_enabled(db_session: Session) -> None:
    """Offene Schreibrouten auf einem oeffentlichen Server halten das Gate rot (ADR-0024)."""
    open_writes = Settings(
        app_env="production",
        admin_api_key="x" * 32,
        mistral_api_key="sk-prod",
        cors_origins="https://wissen.example.com",
        embed_provider="mistral",
        writes_enabled=True,
    )
    results = _results(gate.run_checks(settings=open_writes, session=db_session))
    assert results["Env: Schreibrouten abgeschaltet (WRITES_ENABLED=false)"] is False


def test_gate_needs_mistral_even_when_groq_answers(db_session: Session) -> None:
    """Groq hat keinen Embedding-Endpunkt — ohne Mistral findet die Suche nichts."""
    groq_only = Settings(
        app_env="production",
        admin_api_key="x" * 32,
        mistral_api_key="",
        groq_api_key="gsk-prod",
        cors_origins="https://wissen.example.com",
        embed_provider="mistral",
    )
    results = _results(gate.run_checks(settings=groq_only, session=db_session))
    assert results["Env: Chat-Anbieter konfiguriert (Groq und/oder Mistral)"] is True
    assert results["Env: MISTRAL_API_KEY gesetzt (Embeddings via EU-API)"] is False


def test_gate_red_with_local_embed_provider(db_session: Session) -> None:
    local = Settings(
        app_env="production",
        admin_api_key="x" * 32,
        mistral_api_key="sk-prod",
        cors_origins="https://wissen.example.com",
        embed_provider="ollama",
    )
    results = _results(gate.run_checks(settings=local, session=db_session))
    assert results["Env: EMBED_PROVIDER kommt ohne lokales Modell aus"] is False


def test_gate_red_with_weak_env(db_session: Session) -> None:
    weak = Settings(
        app_env="development",
        admin_api_key="change-me",
        mistral_api_key="",
        groq_api_key="",  # sonst kippt der Check an der .env des Betreibers
        cors_origins="http://localhost:5173",
    )
    results = _results(gate.run_checks(settings=weak, session=db_session))
    assert results["Env: APP_ENV=production"] is False
    assert results["Env: MISTRAL_API_KEY gesetzt (Embeddings via EU-API)"] is False
    # Ohne beide Schlüssel bliebe nur Ollama — auf einem kleinen VPS keine Option.
    assert results["Env: Chat-Anbieter konfiguriert (Groq und/oder Mistral)"] is False
    assert results["Env: CORS ohne localhost"] is False
    assert any(
        name.startswith("Env: ADMIN_API_KEY") and not ok
        for name, ok, _ in gate.run_checks(settings=weak, session=db_session)
    )
