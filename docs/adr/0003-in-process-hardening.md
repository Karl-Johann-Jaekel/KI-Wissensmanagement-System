# ADR 0003 — In-process rate limiting instead of slowapi

- Status: accepted
- Date: 2026-07-22
- Relates to: PLAN §7 Phase 5 (Hardening)

## Context
PLAN Phase 5 names `slowapi` for rate limiting. Adding it changes
`backend/pyproject.toml`, which invalidates the Docker layer that installs the heavy
Docling/torch stack — every dependency edit would re-download ~GB of wheels.

## Decision
Implement rate limiting, the daily token cap, and the input-length limit in-process
(`app/core/security.py`) with the standard library — a per-IP sliding-window limiter,
a per-day token counter, and pydantic `max_length`. No new dependency, no image rebuild.

## Consequences
- State is per-process. Fine for the single-instance MVP deployment (one Uvicorn
  worker behind Caddy). If the deployment ever scales horizontally, move the limiter
  and token counter to Redis (or adopt slowapi + a shared backend) — the call sites
  (`rate_limit` dependency, `get_budget()`) stay the same.
- Token accounting is an estimate (`len/4`), not exact provider usage; good enough for
  a safety cap, not for billing.
