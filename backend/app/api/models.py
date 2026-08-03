"""GET /models — installed Ollama models for the Bibliothek model picker (ADR-0008).

Admin-only: the list reveals local infrastructure and only admin flows (Bibliothek,
model override) can use it. Never 500s on an unreachable Ollama — the UI shows a
hint instead.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.core.config import get_settings
from app.core.security import rate_limit, require_admin
from app.generation.llm import list_ollama_models

router = APIRouter(tags=["models"])


@router.get("/models", dependencies=[Depends(rate_limit)])
def get_models(request: Request) -> dict:
    require_admin(request)
    settings = get_settings()
    models = list_ollama_models(settings.ollama_base_url)
    return {
        "available": models is not None,
        "default": settings.ollama_llm_model,
        "models": models or [],
    }
