"""Deploy-Gate-Checks (scripts/check_no_confidential_in_prod.py, Phase 10)."""

from __future__ import annotations

import importlib.util
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import Document

# Skript liegt außerhalb des app-Pakets — per Pfad importieren. Layouts:
# Container: /app/tests + /app/scripts (Mount) · CI/Host: backend/tests + ../scripts
_CANDIDATES = [
    parent / "scripts" / "check_no_confidential_in_prod.py"
    for parent in Path(__file__).resolve().parents[1:3]
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
)


def _results(checks: list[tuple[str, bool, str]]) -> dict[str, bool]:
    return {name: ok for name, ok, _ in checks}


def test_gate_green_with_public_only_db(db_session: Session) -> None:
    db_session.add(
        Document(source_type="pdf", title="P", content_hash="gate-pub", sensitivity="public")
    )
    db_session.commit()
    results = _results(gate.run_checks(settings=PROD_SETTINGS, session=db_session))
    assert results["DB: keine non-public Dokumente"] is True
    assert results["DB: keine non-public Chunks"] is True
    assert results["Env: APP_ENV=production"] is True
    assert results["Env: MISTRAL_API_KEY gesetzt (public-Zone via EU-API)"] is True
    assert results["Env: CORS ohne localhost"] is True


def test_gate_red_with_confidential_doc(db_session: Session) -> None:
    db_session.add(
        Document(source_type="pdf", title="S", content_hash="gate-conf", sensitivity="confidential")
    )
    db_session.commit()
    results = _results(gate.run_checks(settings=PROD_SETTINGS, session=db_session))
    assert results["DB: keine non-public Dokumente"] is False


def test_gate_red_with_weak_env(db_session: Session) -> None:
    weak = Settings(
        app_env="development",
        admin_api_key="change-me",
        mistral_api_key="",
        cors_origins="http://localhost:5173",
    )
    results = _results(gate.run_checks(settings=weak, session=db_session))
    assert results["Env: APP_ENV=production"] is False
    assert any(
        name.startswith("Env: ADMIN_API_KEY") and not ok
        for name, ok, _ in gate.run_checks(settings=weak, session=db_session)
    )
    assert results["Env: MISTRAL_API_KEY gesetzt (public-Zone via EU-API)"] is False
    assert results["Env: CORS ohne localhost"] is False
