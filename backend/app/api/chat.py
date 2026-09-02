"""POST /chat — RAG answer with citations, streamed as SSE (PLAN §7 Phase 5)."""

from __future__ import annotations

import contextlib
import json
import logging
from collections.abc import Iterator

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.security import (
    MAX_INPUT_CHARS,
    client_key,
    estimate_tokens,
    get_budget,
    rate_limit,
)
from app.db.session import get_db
from app.generation.generate import prepare_answer

router = APIRouter(tags=["chat"])
log = logging.getLogger(__name__)


class ChatRequest(BaseModel):
    query: str = Field(min_length=1, max_length=MAX_INPUT_CHARS)
    top_k: int = Field(default=5, ge=1, le=15)
    rerank: bool | None = None


def sse(obj: dict) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


def error_message(exc: httpx.HTTPError) -> str:
    """Anbieterfehler in einen Satz übersetzen, den ein Besucher verstehen kann.

    Ohne das endet der Strom bei jedem 429 wortlos: der Browser wartet auf Token,
    die nie kommen, und die Oberfläche wirkt eingefroren (ADR-0021).
    """
    status = exc.response.status_code if isinstance(exc, httpx.HTTPStatusError) else None
    if status == 429:
        return "Das Sprachmodell ist gerade ausgelastet. Bitte in einer Minute noch einmal fragen."
    if status is not None and status >= 500:
        return "Das Sprachmodell antwortet gerade nicht. Bitte später erneut versuchen."
    return "Die Antwort konnte nicht erzeugt werden."


@router.post("/chat", dependencies=[Depends(rate_limit)])
def chat(request: Request, req: ChatRequest, db: Session = Depends(get_db)) -> StreamingResponse:
    plan = prepare_answer(db, req.query, top_k=req.top_k, rerank=req.rerank)
    budget = get_budget()
    key = client_key(request)
    budget.add(key, estimate_tokens(plan.messages[-1]["content"]))  # may raise 429

    def gen() -> Iterator[str]:
        parts: list[str] = []
        try:
            for token in plan.client.chat_stream(plan.messages):
                parts.append(token)
                yield sse({"type": "token", "text": token})
        except httpx.HTTPError as exc:
            # Der Statuscode steht schon fest, die Kopfzeilen sind raus — ein
            # HTTP-Fehler ginge ins Leere. Also als Ereignis im Strom melden und
            # ihn danach regulaer mit [DONE] schliessen.
            log.warning("chat stream failed (%s): %s", plan.client.name, exc)
            yield sse({"type": "error", "message": error_message(exc)})
        except Exception as exc:  # noqa: BLE001 — der Strom muss geordnet enden
            # Alles Unerwartete (kaputtes JSON, ein Rahmen ohne choices, ein Fehler
            # im Anbieter-Client) endete bisher hier ohne sources und ohne [DONE]:
            # der Browser wartete danach endlos. GeneratorExit faellt nicht
            # hierunter, ein abgebrochener Abruf bleibt also ein Abbruch.
            log.error("chat stream failed unexpectedly (%s)", plan.client.name, exc_info=exc)
            yield sse({"type": "error", "message": "Die Antwort konnte nicht erzeugt werden."})

        # answer already streamed; the cap is best-effort here
        with contextlib.suppress(HTTPException):
            budget.add(key, estimate_tokens("".join(parts)))

        try:
            sources = plan.sources()
        except Exception:  # noqa: BLE001 — lieber ohne Quellen als ohne Abschluss
            log.exception("sources could not be assembled")
            sources = []
        yield sse(
            {
                "type": "sources",
                "model": plan.client.model,
                "provider": plan.client.name,
                "sources": sources,
            }
        )
        yield "data: [DONE]\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")
