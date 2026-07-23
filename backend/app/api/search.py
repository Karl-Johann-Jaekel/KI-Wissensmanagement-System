"""POST /search — hybrid retrieval with per-arm scores (PLAN §7 Phase 4)."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.security import rate_limit, require_admin_for_nonpublic
from app.db.session import get_db
from app.retrieval.search import hybrid_search

router = APIRouter(tags=["search"])

Sensitivity = Literal["public", "internal", "confidential"]


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    top_k: int = Field(default=5, ge=1, le=20)
    max_sensitivity: Sensitivity = "public"
    rerank: bool | None = None


class SearchHitOut(BaseModel):
    chunk_id: str
    document_id: str
    title: str
    uri: str | None
    sensitivity: str
    content: str
    scores: dict


class SearchResponse(BaseModel):
    query: str
    hits: list[SearchHitOut]


@router.post("/search", response_model=SearchResponse, dependencies=[Depends(rate_limit)])
def search(req: SearchRequest, request: Request, db: Session = Depends(get_db)) -> SearchResponse:
    require_admin_for_nonpublic(request, req.max_sensitivity)
    hits = hybrid_search(
        db,
        req.query,
        top_k=req.top_k,
        max_sensitivity=req.max_sensitivity,
        rerank=req.rerank,
    )
    return SearchResponse(
        query=req.query,
        hits=[SearchHitOut(**vars(h)) for h in hits],
    )
