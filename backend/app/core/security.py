"""Lightweight API hardening (PLAN §7 Phase 5): rate limit, daily token cap, input cap.

In-process (single-instance) implementations — no extra dependency. A per-IP sliding
window limits request rate; a per-day counter caps token spend for the LLM endpoints.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

from app.core.config import get_settings

MAX_INPUT_CHARS = 2000

_UNIT_SECONDS = {"second": 1, "minute": 60, "hour": 3600, "day": 86400}


def _parse_rate(rate: str) -> tuple[int, float]:
    count, _, per = rate.partition("/")
    return int(count), float(_UNIT_SECONDS[per.strip().rstrip("s")])


class SlidingWindowLimiter:
    def __init__(self, rate: str) -> None:
        self.limit, self.window = _parse_rate(rate)
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str) -> None:
        now = time.monotonic()
        dq = self._hits[key]
        while dq and now - dq[0] > self.window:
            dq.popleft()
        if len(dq) >= self.limit:
            raise HTTPException(status_code=429, detail="rate limit exceeded")
        dq.append(now)


class TokenBudget:
    """Best-effort daily token cap (resets at UTC midnight)."""

    def __init__(self, cap: int) -> None:
        self.cap = cap
        self._day: int | None = None
        self.used = 0

    def add(self, tokens: int) -> None:
        day = time.gmtime().tm_yday
        if day != self._day:
            self._day, self.used = day, 0
        if self.used >= self.cap:
            raise HTTPException(status_code=429, detail="daily token budget exhausted")
        self.used += tokens


_limiter: SlidingWindowLimiter | None = None
_budget: TokenBudget | None = None


def _get_limiter() -> SlidingWindowLimiter:
    global _limiter
    if _limiter is None:
        _limiter = SlidingWindowLimiter(get_settings().rate_limit)
    return _limiter


def get_budget() -> TokenBudget:
    global _budget
    if _budget is None:
        _budget = TokenBudget(get_settings().daily_token_cap)
    return _budget


def rate_limit(request: Request) -> None:
    """FastAPI dependency: per-client-IP request rate limiting."""
    client = request.client.host if request.client else "unknown"
    _get_limiter().check(client)


def is_admin(request: Request) -> bool:
    """True if the request carries the admin API key (X-API-Key header)."""
    return request.headers.get("X-API-Key") == get_settings().admin_api_key


def require_admin(request: Request) -> None:
    if not is_admin(request):
        raise HTTPException(status_code=401, detail="admin API key required")


def require_admin_for_nonpublic(request: Request, max_sensitivity: str) -> None:
    """Non-public zones (confidential/internal) require the admin key."""
    if max_sensitivity != "public" and not is_admin(request):
        raise HTTPException(status_code=403, detail="confidential zone requires admin key")


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)
