"""Prompt construction + hardening primitives (no DB)."""

from __future__ import annotations

import time

import pytest
from fastapi import HTTPException

from app.core.security import (
    _CLEANUP_EVERY,
    SlidingWindowLimiter,
    TokenBudget,
    estimate_tokens,
)
from app.generation.prompts import NO_SOURCE, SYSTEM_PROMPT, build_messages
from app.retrieval.search import SearchHit


def _hit(**kw) -> SearchHit:
    base = {
        "chunk_id": "c",
        "document_id": "d",
        "title": "Attention Is All You Need",
        "uri": "http://arxiv.org/abs/1706.03762",
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
    budget.add("ip1", 9)
    budget.add("ip1", 1)  # now at 10
    with pytest.raises(HTTPException):
        budget.add("ip1", 1)


def test_token_budget_is_per_client() -> None:
    """Ein Besucher darf das Tagesbudget nicht fuer alle anderen verbrauchen."""
    budget = TokenBudget(cap=10)
    budget.add("heavy", 10)
    with pytest.raises(HTTPException):
        budget.add("heavy", 1)
    budget.add("someone-else", 1)  # unberuehrt
    assert budget.used_by("heavy") == 10
    assert budget.used_by("someone-else") == 1


def test_rate_limiter_forgets_idle_clients(monkeypatch: pytest.MonkeyPatch) -> None:
    """Der Zustand darf nicht um einen Eintrag je gesehener IP wachsen."""
    clock = {"t": 0.0}
    monkeypatch.setattr(time, "monotonic", lambda: clock["t"])

    lim = SlidingWindowLimiter("100/second")
    for i in range(_CLEANUP_EVERY):  # fuellt bis zur Aufraeumschwelle
        lim.check(f"old{i}")
    assert len(lim._hits) == _CLEANUP_EVERY

    clock["t"] = 10.0  # Fenster (1 s) laengst vorbei
    for i in range(_CLEANUP_EVERY):  # loest das Aufraeumen aus
        lim.check(f"new{i}")

    keys = set(lim._hits)
    assert not any(k.startswith("old") for k in keys)
    assert len(keys) == _CLEANUP_EVERY


def test_estimate_tokens() -> None:
    assert estimate_tokens("") == 1
    assert estimate_tokens("a" * 40) == 10


def test_admin_key_comparison_is_constant_time() -> None:
    """Der Vergleich darf nicht beim ersten abweichenden Zeichen abbrechen.

    Ein frueh abbrechender Vergleich verraet ueber die Laufzeit, wie viele
    Zeichen stimmten — ueber viele Versuche laesst sich ein Schluessel so
    zeichenweise erraten.
    """
    import inspect

    from app.core import security as sec

    quelle = inspect.getsource(sec.is_admin)
    assert "compare_digest" in quelle
    assert "==" not in quelle.split('"""')[-1], "kein direkter Vergleich mehr"


def test_admin_key_rejects_missing_and_wrong(monkeypatch: pytest.MonkeyPatch) -> None:
    from starlette.datastructures import Headers

    from app.core.config import get_settings
    from app.core.security import is_admin

    monkeypatch.setattr(get_settings(), "admin_api_key", "s3cret-key-value", raising=False)

    class _Req:
        def __init__(self, headers: dict[str, str]) -> None:
            self.headers = Headers(headers)

    assert is_admin(_Req({"X-API-Key": "s3cret-key-value"})) is True
    assert is_admin(_Req({"X-API-Key": "s3cret-key-valuX"})) is False
    assert is_admin(_Req({"X-API-Key": ""})) is False
    assert is_admin(_Req({})) is False
