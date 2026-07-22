# ADR 0001 — Record architecture decisions

- Status: accepted
- Date: 2026-07-22

## Context
Non-obvious deviations from PLAN.md, and decisions PLAN.md defers (embedding model,
retrieval params, cron caps), need a durable record so the "why" survives.

## Decision
Use lightweight ADRs in `docs/adr/NNNN-title.md`. One decision per file. Reference the
relevant PLAN.md section. Status: proposed | accepted | superseded.

## Consequences
Every departure from the plan (§9) is traceable. The Phase 3 embedding-model choice
and Phase 4/8 tuning outcomes will each get their own ADR.
