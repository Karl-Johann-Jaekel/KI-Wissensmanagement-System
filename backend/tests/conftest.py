"""Shared pytest fixtures."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import engine
from app.main import app


@pytest.fixture(autouse=True)
def _pin_embed_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    """Tests prüfen Verhalten, nicht die .env des Betreibers.

    Ohne diese Festlegung kippen Embedding- und Ingest-Tests, sobald jemand
    EMBED_PROVIDER=mistral setzt (ADR-0014). Tests, die den entfernten Anbieter
    prüfen, setzen ihn selbst.
    """
    monkeypatch.setattr(get_settings(), "embed_provider", "ollama", raising=False)


@pytest.fixture(autouse=True)
def _reset_rate_limiter() -> None:
    """Der Limiter ist ein Prozess-Global (ADR-0003).

    Ohne Reset summieren sich die Anfragen *aller* Tests auf denselben Schluessel
    ("testclient") und der naechste hinzugefuegte API-Test faellt mit 429 um —
    ein Fehlerbild, das nichts mit dem Test zu tun haette.

    Seit Lese- und Modell-Endpunkte getrennte Zaehler haben, sind es zwei.
    """
    from app.core import security

    security._limiter = None
    security._llm_limiter = None


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def db_session() -> Iterator[Session]:
    """A session bound to a transaction that is rolled back after the test.

    Uses SAVEPOINTs so code under test can call ``session.commit()`` while the outer
    transaction still rolls everything back. Skips the test if no DB is reachable
    (so pure-unit runs don't need Postgres).
    """
    try:
        connection = engine.connect()
    except OperationalError:
        pytest.skip("database not reachable")
    trans = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        session.close()
        if trans.is_active:
            trans.rollback()
        connection.close()
