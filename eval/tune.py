"""Retrieval parameter tuning (PLAN §7 Phase 8: "selbst optimierend, messbar").

Sweeps retrieval parameters over the golden set, reports Hit-Rate@5 per config and the
best one. Optimisation means parameters + data — NOT autonomous code changes — so the
best config is written to a report for a human to adopt (e.g. via .env), not applied.

    python eval/tune.py [--with-rerank]
"""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from itertools import product
from pathlib import Path

import yaml
from sqlalchemy import select

from app.db.models import Document
from app.db.session import SessionLocal
from app.retrieval.search import hybrid_search

REPORTS_DIR = Path("eval/reports")
CANDIDATE_K_GRID = [20, 30, 50]


def _arxiv_map(session) -> dict[str, str | None]:
    rows = session.execute(select(Document.id, Document.meta)).all()
    return {str(did): (meta or {}).get("id") for did, meta in rows}


def _hit_rate(session, golden: list[dict], *, candidate_k: int, rerank: bool) -> float:
    id2arxiv = _arxiv_map(session)
    hits = 0
    for item in golden:
        results = hybrid_search(
            session, item["question"], top_k=5, candidate_k=candidate_k, rerank=rerank
        )
        if item["arxiv_id"] in {id2arxiv.get(h.document_id) for h in results}:
            hits += 1
    return hits / len(golden) if golden else 0.0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--golden", default="eval/golden.yaml")
    parser.add_argument("--with-rerank", action="store_true")
    args = parser.parse_args(argv)

    golden = yaml.safe_load(Path(args.golden).read_text(encoding="utf-8"))
    rerank_grid = [False, True] if args.with_rerank else [False]

    results = []
    with SessionLocal() as session:
        for candidate_k, rerank in product(CANDIDATE_K_GRID, rerank_grid):
            rate = _hit_rate(session, golden, candidate_k=candidate_k, rerank=rerank)
            results.append({"candidate_k": candidate_k, "rerank": rerank, "hit_rate": rate})
            print(f"  candidate_k={candidate_k} rerank={rerank} -> Hit-Rate@5 {rate:.2f}")

    best = max(results, key=lambda r: r["hit_rate"])
    report = {"at": datetime.now(UTC).isoformat(), "grid": results, "best": best}
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    out = REPORTS_DIR / f"tune-{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}.json"
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\nBest: {best}  ->  {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
