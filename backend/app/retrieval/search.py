"""Hybrid retrieval orchestration: vector + lexical -> RRF -> (optional) rerank.

Returns ranked hits with per-arm scores for debugging (PLAN §7 Phase 4 `POST /search`).
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models import Chunk, Document
from app.ingestion.embedding import embed_query
from app.retrieval.hybrid import keyword_search, vector_search
from app.retrieval.rrf import reciprocal_rank_fusion

EmbedQuery = Callable[[str], list[float]]


@dataclass
class SearchHit:
    chunk_id: str
    document_id: str
    title: str
    uri: str | None
    sensitivity: str
    content: str
    scores: dict = field(default_factory=dict)


def _load_chunks(session: Session, ids: list[str]) -> dict[str, tuple[Chunk, Document]]:
    if not ids:
        return {}
    uuids = [uuid.UUID(i) for i in ids]
    rows = session.execute(
        select(Chunk, Document)
        .join(Document, Chunk.document_id == Document.id)
        .where(Chunk.id.in_(uuids))
    ).all()
    return {str(ch.id): (ch, doc) for ch, doc in rows}


def hybrid_search(
    session: Session,
    query: str,
    *,
    top_k: int = 5,
    candidate_k: int = 30,
    max_sensitivity: str = "public",
    rerank: bool | None = None,
    embed_fn: EmbedQuery = embed_query,
) -> list[SearchHit]:
    settings = get_settings()
    q_emb = embed_fn(query)

    vec = vector_search(session, q_emb, top_k=candidate_k, max_sensitivity=max_sensitivity)
    kw = keyword_search(session, query, top_k=candidate_k, max_sensitivity=max_sensitivity)
    vec_scores, kw_scores = dict(vec), dict(kw)

    fused = reciprocal_rank_fusion([[i for i, _ in vec], [i for i, _ in kw]])
    rrf_scores = dict(fused)
    cand_ids = [cid for cid, _ in fused][:candidate_k]
    rows = _load_chunks(session, cand_ids)
    order = [cid for cid in cand_ids if cid in rows]

    do_rerank = settings.rerank_enabled if rerank is None else rerank
    rerank_map: dict[str, float] = {}
    if do_rerank and order:
        from app.retrieval.rerank import rerank_scores

        scores = rerank_scores(query, [rows[cid][0].content for cid in order])
        rerank_map = dict(zip(order, scores, strict=True))
        order = sorted(order, key=lambda cid: rerank_map[cid], reverse=True)

    hits: list[SearchHit] = []
    for cid in order[:top_k]:
        chunk, doc = rows[cid]
        hits.append(
            SearchHit(
                chunk_id=cid,
                document_id=str(doc.id),
                title=doc.title,
                uri=doc.uri,
                sensitivity=doc.sensitivity,
                content=chunk.content,
                scores={
                    "vector": vec_scores.get(cid),
                    "keyword": kw_scores.get(cid),
                    "rrf": rrf_scores.get(cid),
                    "rerank": rerank_map.get(cid),
                },
            )
        )
    return hits
