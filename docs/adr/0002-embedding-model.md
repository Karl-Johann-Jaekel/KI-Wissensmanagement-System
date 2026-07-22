# ADR 0002 — Embedding model: qwen3-embedding:0.6b

- Status: accepted
- Date: 2026-07-22
- Relates to: PLAN §2.3, §4, §7 Phase 3

## Context
PLAN §2.3 requires **one** multilingual embedding model for both indexing and query
(German questions over an English corpus). PLAN Phase 3 proposed benchmarking two
candidates (`qwen3-embedding` vs `multilingual-e5-large`) and fixing the winner.

## Decision
Use **`qwen3-embedding:0.6b`** via Ollama.

- Multilingual, served locally (fits the confidential zone: nothing leaves the machine).
- Output dimension **1024**, matching `chunks.embedding VECTOR(1024)` — no schema change.
- In the official Ollama library, small (~0.6B) → runs on CPU, fast enough for the VPS
  and local dev.

The full two-model benchmark was **skipped by decision** to keep Phase 3 moving; the
model can be re-evaluated later without code changes (see below). This is the one
deviation from Phase 3's "benchmark first" step.

## Consequences
- `EMBED_MODEL=qwen3-embedding:0.6b`, `EMBED_DIM=1024` are fixed in `.env` / settings
  and recorded per chunk (`chunks.embed_model`).
- Changing the model later means: update `.env`, and if the dimension changes, a new
  migration for the `VECTOR(n)` column, then a **full reindex** (re-embed all chunks).
  A `scripts/reindex.py` is planned; until then, re-run ingestion against a clean corpus.
- Retrieval quality on the cross-lingual golden set is measured in Phase 4
  (`eval/run_eval.py`); if Hit-Rate@5 is unsatisfactory, revisit this ADR and run the
  deferred benchmark (e.g. against `bge-m3` or `multilingual-e5-large`).
