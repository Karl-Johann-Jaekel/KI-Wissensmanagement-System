"""Living-knowledge update loop (PLAN §7 Phase 8).

One end-to-end run:
    [optional] delta-fetch new arXiv papers  ->  ingest  ->  LLM extract (pending)
    ->  rule-based promotion (pending -> verified)  ->  golden eval report.

    python -m app.update                       # extract+promote+eval over the corpus
    python -m app.update --since 2026-07-01 --cap 5   # also delta-fetch first

Cost-capped (`--token-budget`) and idempotent (ingest by content_hash, extraction by a
per-document flag). Writes a JSON report to eval/reports/ each run.
"""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

import yaml

from app.core.llm_router import choose_client
from app.corpus.arxiv import delta_fetch
from app.corpus.extract import extract_corpus
from app.corpus.promote import promote_graph
from app.db.session import SessionLocal
from app.ingestion.pipeline import ingest_path

REPORTS_DIR = Path("eval/reports")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--since", default=None, help="ISO date -> delta-fetch new papers first")
    parser.add_argument("--cap", type=int, default=5, help="max new papers per delta-fetch")
    parser.add_argument("--limit", type=int, default=None, help="max papers to extract this run")
    parser.add_argument("--token-budget", type=int, default=200_000)
    parser.add_argument("--corpus-dir", default="data/corpus")
    parser.add_argument("--corpus-yaml", default="demo-data/corpus.yaml")
    parser.add_argument("--no-eval", action="store_true")
    args = parser.parse_args(argv)

    client = choose_client("public")
    report: dict = {"started_at": datetime.now(UTC).isoformat(), "llm": client.name}

    with SessionLocal() as session:
        if args.since:
            queries = yaml.safe_load(Path(args.corpus_yaml).read_text(encoding="utf-8")).get(
                "queries", []
            )
            print(f"Delta-fetch since {args.since} (cap {args.cap}) …")
            fetched = delta_fetch(
                queries,
                datetime.fromisoformat(args.since).date(),
                out=Path(args.corpus_dir),
                cap=args.cap,
            )
            report["fetched"] = fetched

        print("Ingesting corpus …")
        ingest = ingest_path(session, Path(args.corpus_dir), "public")
        report["ingest"] = {
            "added": ingest.added,
            "skipped": ingest.skipped,
            "chunks": ingest.chunks,
        }

        print("Extracting facts (LLM) …")
        ex = extract_corpus(
            session, chat=client.chat, token_budget=args.token_budget, limit=args.limit
        )
        report["extract"] = {"papers": ex.papers, "nodes": ex.nodes, "edges": ex.edges}

        print("Promoting facts …")
        pr = promote_graph(session)
        report["promote"] = {
            "nodes": pr.promoted_nodes,
            "edges": pr.promoted_edges,
            "disputed": pr.disputed,
        }

        if not args.no_eval:
            print("Running golden eval …")
            from eval.run_eval import evaluate

            golden = yaml.safe_load(Path("eval/golden.yaml").read_text(encoding="utf-8"))
            ev = evaluate(session, golden, top_k=5, rerank=False)
            report["eval"] = {
                k: ev[k] for k in ("hit_rate", "hits", "n", "latency_p50", "latency_p95")
            }

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    out = REPORTS_DIR / f"update-{stamp}.json"
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nReport: {out}")
    print(json.dumps({k: v for k, v in report.items() if k != "fetched"}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
