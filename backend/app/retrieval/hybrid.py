"""Hybrid retrieval: dense vector search + lexical BM25/tsquery (PLAN §7 Phase 4).

Both arms run over ``chunks`` filtered by data zone (``sensitivity``). German
questions on the English corpus carry primarily through the multilingual vector arm
(PLAN §2.3/§4); the lexical arm uses Postgres full-text ranking on ``content_tsv``.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import Chunk, Document

# Data-zone ordering: a query may see everything up to its max sensitivity.
SENS_ORDER = {"public": 0, "internal": 1, "confidential": 2}


def allowed_sensitivities(max_sensitivity: str) -> list[str]:
    ceiling = SENS_ORDER[max_sensitivity]
    return [s for s, o in SENS_ORDER.items() if o <= ceiling]


def vector_search(
    session: Session,
    query_embedding: list[float],
    *,
    top_k: int = 30,
    max_sensitivity: str = "public",
) -> list[tuple[str, float]]:
    """Cosine nearest neighbours. Returns [(chunk_id, similarity)] best-first."""
    allowed = allowed_sensitivities(max_sensitivity)
    distance = Chunk.embedding.cosine_distance(query_embedding)
    stmt = (
        select(Chunk.id, distance.label("distance"))
        .join(Document, Chunk.document_id == Document.id)
        .where(Document.sensitivity.in_(allowed))
        .where(Chunk.embedding.isnot(None))
        .order_by(distance)
        .limit(top_k)
    )
    return [(str(cid), 1.0 - float(dist)) for cid, dist in session.execute(stmt)]


def keyword_search(
    session: Session,
    query_text: str,
    *,
    top_k: int = 30,
    max_sensitivity: str = "public",
    config: str = "english",
) -> list[tuple[str, float]]:
    """BM25-ish lexical ranking via Postgres full-text. Returns [(chunk_id, rank)]."""
    allowed = allowed_sensitivities(max_sensitivity)
    tsquery = func.websearch_to_tsquery(config, query_text)
    rank = func.ts_rank(Chunk.content_tsv, tsquery)
    stmt = (
        select(Chunk.id, rank.label("rank"))
        .join(Document, Chunk.document_id == Document.id)
        .where(Document.sensitivity.in_(allowed))
        .where(Chunk.content_tsv.op("@@")(tsquery))
        .order_by(rank.desc())
        .limit(top_k)
    )
    return [(str(cid), float(r)) for cid, r in session.execute(stmt)]
