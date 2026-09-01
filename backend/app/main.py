"""FastAPI application entrypoint."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import __version__
from app.api import chat, documents, graph, health, review, search
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.db.session import SessionLocal
from app.ingestion.embedding import EmbeddingError, assert_index_matches_settings

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    configure_logging()
    settings = get_settings()

    # Lieber gar nicht starten als still die falschen Treffer liefern: läuft die
    # App gegen einen Index, der mit einem anderen Modell gebaut wurde, sieht
    # niemand einen Fehler — die Suche antwortet einfach daneben. Der Docstring
    # der Prüfung nennt das den teuersten Fehler dieses Systems; aufgerufen wurde
    # sie bis hierher nur aus einem Test.
    with SessionLocal() as session:
        assert_index_matches_settings(session)
    log.info(
        "kwms %s gestartet (env=%s, embed=%s/%s, writes=%s)",
        __version__,
        settings.app_env,
        settings.embed_provider,
        settings.embed_model,
        settings.writes_enabled,
    )
    yield


app = FastAPI(
    title="KI-Wissensmanagement-System",
    version=__version__,
    summary="RAG über KI-Forschungskorpus + Wissens-Graph (PLAN.md)",
    lifespan=lifespan,
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


@app.exception_handler(EmbeddingError)
def embedding_unavailable(request: Request, exc: Exception) -> JSONResponse:
    """Ausfall des Embedding-Anbieters ist 503, nicht 500.

    Ohne Query-Embedding findet die Suche nichts — das ist ein vorübergehend
    nicht verfügbarer Dienst, kein Programmfehler. Der Unterschied entscheidet,
    ob ein Aufrufer es später erneut versucht.
    """
    log.error("embedding provider unavailable on %s: %s", request.url.path, exc)
    return JSONResponse(
        status_code=503,
        content={"detail": "embedding provider unavailable"},
    )


@app.exception_handler(Exception)
def unhandled_error(request: Request, exc: Exception) -> JSONResponse:
    """Letzte Instanz: geloggt mit Traceback, nach außen ohne Innenleben.

    Vorher endete jeder unerwartete Fehler als nackter 500 ohne Logzeile — auf
    einem öffentlichen Server heißt das, dass niemand davon erfährt.
    """
    # exc_info ausdruecklich: Starlette ruft den Handler ausserhalb des
    # except-Blocks auf, dort waere sys.exc_info() leer und das Log ohne Traceback.
    log.error(
        "unhandled error on %s %s: %s",
        request.method,
        request.url.path,
        exc,
        exc_info=exc,
    )
    return JSONResponse(status_code=500, content={"detail": "internal server error"})


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "kwms", "docs": "/docs", "health": "/health"}
