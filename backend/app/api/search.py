"""POST /search — hybrid retrieval with per-arm scores (PLAN §7 Phase 4)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.security import rate_limit
from app.db.session import get_db
from app.retrieval.search import hybrid_search

router = APIRouter(tags=["search"])


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    top_k: int = Field(default=5, ge=1, le=20)
    rerank: bool | None = None


class SearchHitOut(BaseModel):
    chunk_id: str
    document_id: str
    title: str
    uri: str | None
    content: str
    scores: dict


class SearchResponse(BaseModel):
    query: str
    hits: list[SearchHitOut]


@router.post("/search", response_model=SearchResponse, dependencies=[Depends(rate_limit)])
def search(req: SearchRequest, db: Session = Depends(get_db)) -> SearchResponse:
    hits = hybrid_search(db, req.query, top_k=req.top_k, rerank=req.rerank)
    return SearchResponse(query=req.query, hits=[SearchHitOut(**vars(h)) for h in hits])
