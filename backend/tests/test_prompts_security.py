"""Prompt construction + hardening primitives (no DB)."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.core.security import SlidingWindowLimiter, TokenBudget, estimate_tokens
from app.generation.prompts import NO_SOURCE, SYSTEM_PROMPT, build_messages
from app.retrieval.search import SearchHit


def _hit(**kw) -> SearchHit:
    base = {
        "chunk_id": "c",
        "document_id": "d",
        "title": "Attention Is All You Need",
        "uri": "http://arxiv.org/abs/1706.03762",
        "sensitivity": "public",
        "content": "Self-attention relates positions of a single sequence.",
        "heading": "Model Architecture",
    }
    base.update(kw)
    return SearchHit(**base)


def test_system_prompt_has_guardrails() -> None:
    assert NO_SOURCE in SYSTEM_PROMPT
    assert "[Titel, Abschnitt]" in SYSTEM_PROMPT


def test_build_messages_includes_context_and_source_labels() -> None:
    msgs = build_messages("Wie funktioniert Self-Attention?", [_hit()])
    assert msgs[0]["role"] == "system"
    assert "Attention Is All You Need" in msgs[1]["content"]
    assert "Model Architecture" in msgs[1]["content"]


def test_build_messages_empty_context() -> None:
    msgs = build_messages("x", [])
    assert "kein Kontext" in msgs[1]["content"]


def test_rate_limiter_blocks_after_limit() -> None:
    lim = SlidingWindowLimiter("2/minute")
    lim.check("ip1")
    lim.check("ip1")
    with pytest.raises(HTTPException) as exc:
        lim.check("ip1")
    assert exc.value.status_code == 429


def test_rate_limiter_is_per_key() -> None:
    lim = SlidingWindowLimiter("1/minute")
    lim.check("a")
    lim.check("b")  # different client, still allowed


def test_token_budget_exhausts() -> None:
    budget = TokenBudget(cap=10)
    budget.add(9)
    budget.add(1)  # now at 10
    with pytest.raises(HTTPException):
        budget.add(1)


def test_estimate_tokens() -> None:
    assert estimate_tokens("") == 1
    assert estimate_tokens("a" * 40) == 10
