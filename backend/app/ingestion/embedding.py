"""Embeddings via Ollama (PLAN §2.3: one multilingual model for index AND query).

Talks to Ollama's /api/embed. Batched with retry/backoff. The model name and its
dimension come from settings and are recorded per chunk (``embed_model``).
"""

from __future__ import annotations

import time

import httpx

from app.core.config import get_settings

EMBED_ENDPOINT = "/api/embed"


class EmbeddingError(RuntimeError):
    pass


def embed_texts(
    texts: list[str],
    *,
    model: str | None = None,
    base_url: str | None = None,
    batch_size: int = 16,
    retries: int = 3,
    client: httpx.Client | None = None,
) -> list[list[float]]:
    """Embed a list of texts, preserving order. Returns one vector per input."""
    if not texts:
        return []
    settings = get_settings()
    model = model or settings.embed_model
    base_url = base_url or settings.ollama_base_url

    own_client = client is None
    http = client or httpx.Client(base_url=base_url, timeout=120.0)
    vectors: list[list[float]] = []
    try:
        for start in range(0, len(texts), batch_size):
            batch = texts[start : start + batch_size]
            vectors.extend(_embed_batch(http, model, batch, retries))
    finally:
        if own_client:
            http.close()

    if len(vectors) != len(texts):
        raise EmbeddingError(f"expected {len(texts)} vectors, got {len(vectors)}")
    return vectors


def _embed_batch(
    http: httpx.Client, model: str, batch: list[str], retries: int
) -> list[list[float]]:
    last_exc: Exception | None = None
    for attempt in range(retries):
        try:
            resp = http.post(EMBED_ENDPOINT, json={"model": model, "input": batch})
            resp.raise_for_status()
            data = resp.json()
            embeddings = data.get("embeddings")
            if not embeddings or len(embeddings) != len(batch):
                raise EmbeddingError(f"bad embeddings payload for batch of {len(batch)}")
            return embeddings
        except (httpx.HTTPError, EmbeddingError) as exc:
            last_exc = exc
            if attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1))
    raise EmbeddingError(f"embedding failed after {retries} attempts: {last_exc}")


def embed_query(text: str, **kwargs: object) -> list[float]:
    return embed_texts([text], **kwargs)[0]  # type: ignore[arg-type]
