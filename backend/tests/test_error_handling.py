"""Fehlerbehandlung und Logging der API (L5).

Vorher endete jeder unerwartete Fehler als nackter 500 ohne Logzeile, und
LOG_LEVEL war deklariert, aber nirgends gelesen.
"""

from __future__ import annotations

import logging

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.logging import APP_LOGGER, configure_logging
from app.ingestion.embedding import EmbeddingError
from app.main import app, embedding_unavailable, unhandled_error


@pytest.fixture
def failing_app() -> FastAPI:
    """Eigene App mit denselben Handlern — die echten Routen bleiben unberührt."""
    probe = FastAPI()
    probe.add_exception_handler(EmbeddingError, embedding_unavailable)
    probe.add_exception_handler(Exception, unhandled_error)

    @probe.get("/boom")
    def boom() -> None:
        raise RuntimeError("etwas ging schief: geheimes Detail")

    @probe.get("/no-embeddings")
    def no_embeddings() -> None:
        raise EmbeddingError("mistral 503")

    return probe


def test_unhandled_error_is_500_without_internals(
    failing_app: FastAPI, caplog: pytest.LogCaptureFixture
) -> None:
    client = TestClient(failing_app, raise_server_exceptions=False)
    with caplog.at_level(logging.ERROR):
        resp = client.get("/boom")

    assert resp.status_code == 500
    assert resp.json() == {"detail": "internal server error"}
    # Das Innenleben gehoert ins Log, nicht in die Antwort.
    assert "geheimes Detail" not in resp.text
    assert "geheimes Detail" in caplog.text
    assert "unhandled error on GET /boom" in caplog.text


def test_embedding_outage_is_503_not_500(failing_app: FastAPI) -> None:
    """Ein ausgefallener Anbieter ist voruebergehend — 503 sagt: spaeter erneut."""
    client = TestClient(failing_app, raise_server_exceptions=False)
    resp = client.get("/no-embeddings")
    assert resp.status_code == 503
    assert resp.json() == {"detail": "embedding provider unavailable"}


def test_api_registers_both_handlers() -> None:
    """Die Handler haengen an der echten App, nicht nur an der Testattrappe."""
    assert app.exception_handlers[EmbeddingError] is embedding_unavailable
    assert app.exception_handlers[Exception] is unhandled_error


def test_configure_logging_applies_the_level() -> None:
    """LOG_LEVEL war tote Konfiguration — jetzt wirkt es."""
    configure_logging("WARNING")
    assert logging.getLogger(APP_LOGGER).level == logging.WARNING
    configure_logging("DEBUG")
    assert logging.getLogger(APP_LOGGER).level == logging.DEBUG
