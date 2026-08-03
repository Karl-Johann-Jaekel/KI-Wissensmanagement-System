"""POST /chat — RAG answer with citations, streamed as SSE (PLAN §7 Phase 5)."""

from __future__ import annotations

import contextlib
import json
from collections.abc import Iterator
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import (
    MAX_INPUT_CHARS,
    estimate_tokens,
    get_budget,
    rate_limit,
    require_admin,
    require_admin_for_nonpublic,
)
from app.db.session import get_db
from app.generation.generate import prepare_answer
from app.generation.llm import list_ollama_models

router = APIRouter(tags=["chat"])
Sensitivity = Literal["public", "internal", "confidential"]


class ChatRequest(BaseModel):
    query: str = Field(min_length=1, max_length=MAX_INPUT_CHARS)
    top_k: int = Field(default=5, ge=1, le=15)
    max_sensitivity: Sensitivity = "public"
    rerank: bool | None = None
    # Ollama-Modell-Override (ADR-0008): nur mit Admin-Key, nur für Ollama wirksam.
    model: str | None = Field(default=None, max_length=100)


def sse(obj: dict) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


@router.post("/chat", dependencies=[Depends(rate_limit)])
def chat(req: ChatRequest, request: Request, db: Session = Depends(get_db)) -> StreamingResponse:
    require_admin_for_nonpublic(request, req.max_sensitivity)
    if req.model:
        # Anonyme Nutzer sollen keine Modelle wählen/proben können.
        require_admin(request)
        installed = list_ollama_models(get_settings().ollama_base_url)
        if installed is not None and req.model not in {m["name"] for m in installed}:
            raise HTTPException(status_code=400, detail=f"unknown model '{req.model}'")
    plan = prepare_answer(
        db,
        req.query,
        top_k=req.top_k,
        max_sensitivity=req.max_sensitivity,
        rerank=req.rerank,
        model=req.model,
    )
    budget = get_budget()
    budget.add(estimate_tokens(plan.messages[-1]["content"]))  # may raise 429

    def gen() -> Iterator[str]:
        parts: list[str] = []
        for token in plan.client.chat_stream(plan.messages):
            parts.append(token)
            yield sse({"type": "token", "text": token})
        # answer already streamed; the cap is best-effort here
        with contextlib.suppress(HTTPException):
            budget.add(estimate_tokens("".join(parts)))
        yield sse(
            {
                "type": "sources",
                "zone": plan.zone,
                "model": plan.client.model,
                "provider": plan.client.name,
                "sources": plan.sources(),
            }
        )
        yield "data: [DONE]\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")
