"""Hybrid retrieval: dense vector search + lexical BM25/tsquery (PLAN §7 Phase 4).

Both arms run over ``chunks``. German questions on the English corpus carry
primarily through the multilingual vector arm (PLAN §2.3/§4); the lexical arm uses
Postgres full-text ranking on ``content_tsv``.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import Chunk


def vector_search(
    session: Session,
    query_embedding: list[float],
    *,
    top_k: int = 30,
) -> list[tuple[str, float]]:
    """Cosine nearest neighbours. Returns [(chunk_id, similarity)] best-first."""
    distance = Chunk.embedding.cosine_distance(query_embedding)
    stmt = (
        select(Chunk.id, distance.label("distance"))
        .where(Chunk.embedding.isnot(None))
        .order_by(distance)
        .limit(top_k)
    )
    return [(str(cid), 1.0 - float(dist)) for cid, dist in session.execute(stmt)]


#: Textsuch-Konfigurationen, die im Bestand vorkommen können. ``content_tsv`` wird je
#: Zeile mit der Sprache des Dokuments erzeugt (models.py); eine deutsche tsvector
#: trifft nie eine englische tsquery. Wer nur mit einer Konfiguration sucht, macht
#: alle Dokumente der jeweils anderen Sprache lexikalisch unsichtbar — sie kämen dann
#: allein über den Vektorarm zurück.
TEXT_CONFIGS = ("english", "german")


def keyword_search(
    session: Session,
    query_text: str,
    *,
    top_k: int = 30,
    config: str = "english",
) -> list[tuple[str, float]]:
    """BM25-ish lexical ranking via Postgres full-text. Returns [(chunk_id, rank)]."""
    tsquery = func.websearch_to_tsquery(config, query_text)
    rank = func.ts_rank(Chunk.content_tsv, tsquery)
    stmt = (
        select(Chunk.id, rank.label("rank"))
        .where(Chunk.content_tsv.op("@@")(tsquery))
        .order_by(rank.desc())
        .limit(top_k)
    )
    return [(str(cid), float(r)) for cid, r in session.execute(stmt)]
