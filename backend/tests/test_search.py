"""DB-backed hybrid search test (fake embeddings; no Ollama).

Skipped when no DB reachable. Verifies vector+lexical fusion returns the expected
chunk for a query.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models import Chunk, Document
from app.retrieval.search import hybrid_search

DIM = get_settings().embed_dim


def _one_hot(k: int) -> list[float]:
    return [1.0 if i == k else 0.0 for i in range(DIM)]


def _seed(session: Session) -> None:
    pub = Document(source_type="pdf", title="Public Doc", content_hash="hash-pub")
    conf = Document(source_type="pdf", title="Second Doc", content_hash="hash-2")
    session.add_all([pub, conf])
    session.flush()

    model = get_settings().embed_model
    session.add_all(
        [
            Chunk(
                document_id=pub.id,
                chunk_index=0,
                content="zzqmarker alpha retrieval passage",
                lang="english",
                embedding=_one_hot(0),
                embed_model=model,
            ),
            Chunk(
                document_id=pub.id,
                chunk_index=1,
                content="beta unrelated content",
                lang="english",
                embedding=_one_hot(1),
                embed_model=model,
            ),
            Chunk(
                document_id=pub.id,
                chunk_index=2,
                content="gamma unrelated content",
                lang="english",
                embedding=_one_hot(2),
                embed_model=model,
            ),
            Chunk(
                document_id=conf.id,
                chunk_index=0,
                content="zzqmarker secret material",
                lang="english",
                embedding=_one_hot(0),
                embed_model=model,
            ),
        ]
    )
    session.commit()


def test_hybrid_search_ranks_expected_chunk(db_session: Session) -> None:
    _seed(db_session)
    hits = hybrid_search(db_session, "zzqmarker", top_k=5, embed_fn=lambda _q: _one_hot(0))
    assert hits, "expected at least one hit"
    assert "zzqmarker" in hits[0].content
    # per-arm scores are populated for debugging
    assert hits[0].scores["vector"] is not None
    assert hits[0].scores["rrf"] is not None
