"""Shared pytest fixtures."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.db.session import engine
from app.main import app


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
