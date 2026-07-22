"""Golden-set retrieval eval (PLAN §7 Phase 4 DoD: Hit-Rate@5 >= 0.8, latency < 2s).

    python eval/run_eval.py [--golden eval/golden.yaml] [--top-k 5] [--with-rerank]

Reports Hit-Rate@k and latency percentiles, with and (optionally) without the
reranker. A hit = the expected paper's arXiv id appears among the top-k results.
"""

from __future__ import annotations

import argparse
import statistics
from pathlib import Path
from time import perf_counter

import yaml
from sqlalchemy import select

from app.db.models import Document
from app.db.session import SessionLocal
from app.retrieval.search import hybrid_search


def _arxiv_map(session) -> dict[str, str | None]:
    rows = session.execute(select(Document.id, Document.meta)).all()
    return {str(did): (meta or {}).get("id") for did, meta in rows}


def evaluate(session, golden: list[dict], *, top_k: int, rerank: bool) -> dict:
    id2arxiv = _arxiv_map(session)
    hits = 0
    latencies: list[float] = []
    misses: list[str] = []
    for item in golden:
        t0 = perf_counter()
        results = hybrid_search(session, item["question"], top_k=top_k, rerank=rerank)
        latencies.append(perf_counter() - t0)
        found = {id2arxiv.get(h.document_id) for h in results}
        if item["arxiv_id"] in found:
            hits += 1
        else:
            misses.append(f"{item['arxiv_id']} ({item.get('lang', '?')}): {item['question'][:60]}")
    n = len(golden)
    return {
        "hit_rate": hits / n if n else 0.0,
        "hits": hits,
        "n": n,
        "latency_p50": statistics.median(latencies) if latencies else 0.0,
        "latency_p95": (sorted(latencies)[int(0.95 * (len(latencies) - 1))] if latencies else 0.0),
        "misses": misses,
    }


def _print(label: str, r: dict) -> None:
    print(f"\n[{label}]  Hit-Rate@k = {r['hit_rate']:.2f}  ({r['hits']}/{r['n']})")
    print(f"  latency  p50={r['latency_p50'] * 1000:.0f}ms  p95={r['latency_p95'] * 1000:.0f}ms")
    for m in r["misses"]:
        print(f"  miss: {m}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--golden", default="eval/golden.yaml")
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--with-rerank", action="store_true")
    args = parser.parse_args(argv)

    golden = yaml.safe_load(Path(args.golden).read_text(encoding="utf-8"))
    with SessionLocal() as session:
        base = evaluate(session, golden, top_k=args.top_k, rerank=False)
        _print("no rerank", base)
        if args.with_rerank:
            reranked = evaluate(session, golden, top_k=args.top_k, rerank=True)
            _print("with rerank", reranked)

    ok = base["hit_rate"] >= 0.8
    print(f"\nDoD Hit-Rate@{args.top_k} >= 0.80: {'PASS' if ok else 'FAIL'}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
