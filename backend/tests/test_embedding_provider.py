"""Embedding-Anbieter und Index/Query-Konsistenz (ADR-0014)."""

from __future__ import annotations

import httpx
import pytest
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models import Chunk, Document
from app.ingestion.embedding import (
    IndexModelMismatch,
    assert_index_matches_settings,
    embed_texts,
)


def _client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler), base_url="http://test")


def test_ollama_provider_uses_api_embed(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict = {}

    def handle(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        return httpx.Response(200, json={"embeddings": [[0.1, 0.2], [0.3, 0.4]]})

    monkeypatch.setattr(get_settings(), "embed_provider", "ollama", raising=False)
    vectors = embed_texts(["a", "b"], client=_client(handle))
    assert seen["path"] == "/api/embed"
    assert vectors == [[0.1, 0.2], [0.3, 0.4]]


def test_mistral_provider_uses_v1_embeddings(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict = {}

    def handle(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        # bewusst verdreht, um die Sortierung nach index zu prüfen
        return httpx.Response(
            200,
            json={
                "data": [
                    {"index": 1, "embedding": [0.9]},
                    {"index": 0, "embedding": [0.1]},
                ]
            },
        )

    monkeypatch.setattr(get_settings(), "embed_provider", "mistral", raising=False)
    vectors = embed_texts(["erste", "zweite"], client=_client(handle))
    assert seen["path"] == "/v1/embeddings"
    assert vectors == [[0.1], [0.9]]  # Reihenfolge der Eingabe wiederhergestellt


def test_index_mismatch_raises(db_session: Session) -> None:
    doc = Document(source_type="pdf", title="Mismatch Doc", content_hash="emb-mismatch")
    db_session.add(doc)
    db_session.flush()
    db_session.add(
        Chunk(
            document_id=doc.id,
            chunk_index=0,
            content="text",
            embed_model="ein-anderes-modell",
        )
    )
    db_session.commit()

    with pytest.raises(IndexModelMismatch) as exc:
        assert_index_matches_settings(db_session)
    assert "reindex" in str(exc.value)
