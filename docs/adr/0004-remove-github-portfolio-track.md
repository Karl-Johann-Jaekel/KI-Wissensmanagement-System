# ADR 0004 — Remove the GitHub portfolio track (Track A)

- Status: accepted
- Date: 2026-07-23
- Relates to: PLAN §1 Track A, §7 Phasen 1–2, Teile von 5–6

## Context
The project originally had two tracks: Track A (GitHub portfolio graph + recruiter
agent) and Track B (AI-research RAG + knowledge graph + recursive update loop).
After Phases 0–6 were built and verified, the owner decided to drop the portfolio
aspect entirely and focus the product on Track B.

## Decision
Remove Track A end-to-end:

- **Deleted:** `app/github/` (sync + rule-based extraction), `app/sync_github.py`,
  `app/generation/portfolio_agent.py`, `POST /portfolio/chat`, portfolio UI
  (tab, technology filter, repo side panel), their tests, `GITHUB_*` config/env.
- **Data purged:** repo/technology/domain graph nodes (+ edges via cascade) and
  `github_readme` documents.
- **Kept (Track B needs them):** the graph schema incl. all kinds/relations (no
  migration churn; unused kinds are inert), the generic force-graph UI (now the
  knowledge graph view), and the idempotent upsert helpers — moved from
  `github/extract.py` to `app/db/graph.py` with an explicit `status` parameter for
  Phase 8's pending/verified staging.

## Consequences
- `/graph` serves only the knowledge graph (paper/concept/model/dataset); public
  sees `verified`, `include_pending=true` is the Review-Queue view.
- PLAN Phasen 1–2 remain checked-off history; their deliverables are retired.
  The remaining roadmap (7 MCP/n8n, 8 living knowledge, 9 deployment) is unchanged
  minus portfolio mentions.
- The GitHub PAT is no longer needed anywhere — removed from `.env`; owner should
  revoke it on GitHub.
- Portfolio code stays recoverable in git history (branches `phase-1-github-sync`
  … `phase-6-frontend`).
