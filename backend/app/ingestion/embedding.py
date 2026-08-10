"""Embeddings — ein multilinguales Modell für Index UND Query (PLAN §2.3, ADR-0002).

Zwei Anbieter, per ``EMBED_PROVIDER`` gewählt (ADR-0014):

* ``ollama``  — lokaler Betrieb, ``/api/embed``. Nichts verlässt den Rechner und ist
  damit die einzige Option für die Zone ``confidential``.
* ``mistral`` — EU-API (AVV), ``/v1/embeddings``, Modell ``mistral-embed`` mit
  ebenfalls 1024 Dimensionen. Für kleine Server ohne GPU/RAM für lokale Modelle.

**Ein Bestand trägt genau ein Modell.** Vektoren verschiedener Modelle liegen in
verschiedenen Räumen; sie zu mischen liefert stillen Unsinn statt eines Fehlers.
Deshalb steht ``embed_model`` an jedem Chunk und ``assert_index_matches_settings``
prüft den Bestand gegen die Konfiguration.
"""

from __future__ import annotations

import time

import httpx

from app.core.config import get_settings

OLLAMA_EMBED_ENDPOINT = "/api/embed"
MISTRAL_API = "https://api.mistral.ai"
MISTRAL_EMBED_ENDPOINT = "/v1/embeddings"


class EmbeddingError(RuntimeError):
    pass


def embed_texts(
    texts: list[str],
    *,
    model: str | None = None,
    base_url: str | None = None,
    batch_size: int | None = None,
    retries: int = 3,
    client: httpx.Client | None = None,
) -> list[list[float]]:
    """Embed a list of texts, preserving order. Returns one vector per input."""
    if not texts:
        return []
    settings = get_settings()
    model = model or settings.embed_model
    provider = settings.embed_provider
    if batch_size is None:
        batch_size = 16 if provider == "ollama" else 64

    own_client = client is None
    if provider == "mistral":
        if not settings.mistral_api_key and own_client:
            raise EmbeddingError("EMBED_PROVIDER=mistral, aber MISTRAL_API_KEY fehlt")
        http = client or httpx.Client(
            base_url=MISTRAL_API,
            headers={"Authorization": f"Bearer {settings.mistral_api_key}"},
            timeout=120.0,
        )
        embed_batch = _embed_batch_mistral
    else:
        http = client or httpx.Client(base_url=base_url or settings.ollama_base_url, timeout=120.0)
        embed_batch = _embed_batch_ollama

    vectors: list[list[float]] = []
    try:
        for start in range(0, len(texts), batch_size):
            batch = texts[start : start + batch_size]
            vectors.extend(embed_batch(http, model, batch, retries))
    finally:
        if own_client:
            http.close()

    if len(vectors) != len(texts):
        raise EmbeddingError(f"expected {len(texts)} vectors, got {len(vectors)}")
    return vectors


def _with_retry(call, retries: int):  # type: ignore[no-untyped-def]
    last_exc: Exception | None = None
    for attempt in range(retries):
        try:
            return call()
        except (httpx.HTTPError, EmbeddingError) as exc:
            last_exc = exc
            if attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1))
    raise EmbeddingError(f"embedding failed after {retries} attempts: {last_exc}")


def _embed_batch_ollama(
    http: httpx.Client, model: str, batch: list[str], retries: int
) -> list[list[float]]:
    def call() -> list[list[float]]:
        resp = http.post(OLLAMA_EMBED_ENDPOINT, json={"model": model, "input": batch})
        resp.raise_for_status()
        embeddings = resp.json().get("embeddings")
        if not embeddings or len(embeddings) != len(batch):
            raise EmbeddingError(f"bad embeddings payload for batch of {len(batch)}")
        return list(embeddings)

    return _with_retry(call, retries)


def _embed_batch_mistral(
    http: httpx.Client, model: str, batch: list[str], retries: int
) -> list[list[float]]:
    def call() -> list[list[float]]:
        resp = http.post(MISTRAL_EMBED_ENDPOINT, json={"model": model, "input": batch})
        resp.raise_for_status()
        data = resp.json().get("data")
        if not data or len(data) != len(batch):
            raise EmbeddingError(f"bad embeddings payload for batch of {len(batch)}")
        # Reihenfolge über den index absichern, nicht auf die Listenfolge vertrauen.
        ordered = sorted(data, key=lambda d: d.get("index", 0))
        return [d["embedding"] for d in ordered]

    return _with_retry(call, retries)


def embed_query(text: str, **kwargs: object) -> list[float]:
    return embed_texts([text], **kwargs)[0]  # type: ignore[arg-type]


class IndexModelMismatch(RuntimeError):
    """Der Bestand wurde mit einem anderen Embedding-Modell gebaut als konfiguriert."""


def index_embed_models(session) -> list[str]:  # type: ignore[no-untyped-def]
    """Alle in den Chunks vermerkten Embedding-Modelle."""
    from sqlalchemy import distinct, select

    from app.db.models import Chunk

    return [m for m in session.execute(select(distinct(Chunk.embed_model))).scalars() if m]


def assert_index_matches_settings(session) -> None:  # type: ignore[no-untyped-def]
    """Abbrechen, wenn Query- und Index-Modell auseinanderlaufen.

    Ein stiller Mismatch ist der teuerste Fehler dieses Systems: Die Suche liefert
    weiterhin Treffer, nur sind es die falschen. Deshalb lauter Abbruch.
    """
    configured = get_settings().embed_model
    found = index_embed_models(session)
    if not found or found == [configured]:
        return
    raise IndexModelMismatch(
        f"Index enthält Embeddings von {found}, konfiguriert ist '{configured}'. "
        "Entweder EMBED_MODEL zurückstellen oder mit scripts/reindex.py neu einbetten."
    )
