"""FastAPI application entrypoint."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api import chat, documents, graph, health, review, search
from app.core.config import get_settings

app = FastAPI(
    title="KI-Wissensmanagement-System",
    version=__version__,
    summary="RAG über KI-Forschungskorpus + Wissens-Graph (PLAN.md)",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins_list,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(graph.router)
app.include_router(search.router)
app.include_router(chat.router)
app.include_router(documents.router)
app.include_router(review.router)


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "kwms", "docs": "/docs", "health": "/health"}
