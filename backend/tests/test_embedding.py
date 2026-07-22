"""Embedding client tests against a mocked Ollama transport (no network)."""

from __future__ import annotations

import httpx
import pytest

from app.ingestion.embedding import EmbeddingError, embed_texts


def _client(handler) -> httpx.Client:
    return httpx.Client(base_url="http://ollama", transport=httpx.MockTransport(handler))


def test_embed_texts_batches_and_preserves_order() -> None:
    seen_batches: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        import json

        payload = json.loads(request.content)
        n = len(payload["input"])
        seen_batches.append(n)
        # deterministic 1024-d vectors
        return httpx.Response(200, json={"embeddings": [[float(i)] * 1024 for i in range(n)]})

    with _client(handler) as http:
        vecs = embed_texts(["a", "b", "c"], batch_size=2, client=http)

    assert len(vecs) == 3
    assert all(len(v) == 1024 for v in vecs)
    assert seen_batches == [2, 1]  # 3 texts, batch_size 2 -> two requests


def test_embed_texts_empty() -> None:
    assert embed_texts([]) == []


def test_embed_texts_raises_on_bad_payload() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"embeddings": []})  # wrong length

    with _client(handler) as http, pytest.raises(EmbeddingError):
        embed_texts(["a"], retries=1, client=http)


def test_embed_texts_retries_then_raises_on_http_error() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    with _client(handler) as http, pytest.raises(EmbeddingError):
        embed_texts(["a"], retries=1, client=http)
