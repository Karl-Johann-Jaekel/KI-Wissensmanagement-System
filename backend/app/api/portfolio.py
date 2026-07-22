"""POST /portfolio/chat — recruiter agent over the portfolio graph + READMEs.

Hard-limited to the public zone (PLAN §7 Phase 5): uses fixed graph tools, never
touches confidential data, and always routes to the public LLM.
"""

from __future__ import annotations

import contextlib
from collections.abc import Iterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.chat import sse
from app.core.llm_router import choose_client
from app.core.security import MAX_INPUT_CHARS, estimate_tokens, get_budget, rate_limit
from app.db.session import get_db
from app.generation.portfolio_agent import build_portfolio_context

router = APIRouter(tags=["portfolio"])

PORTFOLIO_SYSTEM = (
    "Du bist ein Assistent, der Recruitern das GitHub-Portfolio des Kandidaten erklärt.\n"
    "Antworte AUSSCHLIESSLICH auf Basis des Kontexts (Repositories + READMEs).\n"
    "Nenne relevante Repositories mit Namen und Link. Wenn der Kontext nicht ausreicht,\n"
    "sage das ehrlich. Antworte in der Sprache der Frage."
)


class PortfolioRequest(BaseModel):
    query: str = Field(min_length=1, max_length=MAX_INPUT_CHARS)


@router.post("/portfolio/chat", dependencies=[Depends(rate_limit)])
def portfolio_chat(req: PortfolioRequest, db: Session = Depends(get_db)) -> StreamingResponse:
    context, sources = build_portfolio_context(db, req.query)
    messages = [
        {"role": "system", "content": PORTFOLIO_SYSTEM},
        {"role": "user", "content": f"Kontext:\n{context}\n\nFrage: {req.query}"},
    ]
    client = choose_client("public")  # recruiter agent is always public-zone
    budget = get_budget()
    budget.add(estimate_tokens(messages[-1]["content"]))

    def gen() -> Iterator[str]:
        parts: list[str] = []
        for token in client.chat_stream(messages):
            parts.append(token)
            yield sse({"type": "token", "text": token})
        with contextlib.suppress(HTTPException):
            budget.add(estimate_tokens("".join(parts)))
        yield sse({"type": "sources", "zone": "public", "sources": sources})
        yield "data: [DONE]\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")
