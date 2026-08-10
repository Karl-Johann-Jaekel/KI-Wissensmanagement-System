"""RAG answer preparation: retrieve -> build messages -> pick the LLM client."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.core.llm_router import choose_client
from app.generation.llm import LLMClient
from app.generation.prompts import build_messages
from app.retrieval.search import SearchHit, hybrid_search


@dataclass
class AnswerPlan:
    hits: list[SearchHit]
    messages: list[dict]
    client: LLMClient

    def sources(self) -> list[dict]:
        return [
            {
                "title": h.title,
                "uri": h.uri,
                "section": h.heading,
                "chunk_id": h.chunk_id,
                "preview": h.content[:240] + ("…" if len(h.content) > 240 else ""),
            }
            for h in self.hits
        ]


def prepare_answer(
    session: Session,
    query: str,
    *,
    top_k: int = 5,
    rerank: bool | None = None,
) -> AnswerPlan:
    hits = hybrid_search(session, query, top_k=top_k, rerank=rerank)
    messages = build_messages(query, hits)
    return AnswerPlan(hits=hits, messages=messages, client=choose_client())
