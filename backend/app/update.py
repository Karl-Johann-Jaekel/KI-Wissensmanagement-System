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
import logging
from datetime import UTC, datetime
from pathlib import Path

import yaml
from sqlalchemy import text

from app.core.llm_router import choose_client
from app.core.logging import configure_logging
from app.corpus.arxiv import delta_fetch
from app.corpus.extract import extract_corpus
from app.corpus.promote import promote_graph
from app.db.session import SessionLocal
from app.ingestion.pipeline import ingest_path

log = logging.getLogger(__name__)

REPORTS_DIR = Path("eval/reports")

#: Feste Kennung fuer den Griff der Datenbank-Sperre. Zwei ueberlappende Cron-Laeufe
#: lesen sonst beide ``facts_extracted``, bevor einer committet — und extrahieren
#: dieselben Papers doppelt, zum doppelten Preis.
_LOCK_KEY = 0x4B574D53  # "KWMS"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--since", default=None, help="ISO date -> delta-fetch new papers first")
    parser.add_argument("--cap", type=int, default=5, help="max new papers per delta-fetch")
    parser.add_argument("--limit", type=int, default=None, help="max papers to extract this run")
    parser.add_argument("--token-budget", type=int, default=200_000)
    parser.add_argument("--corpus-dir", default="data/corpus")
    parser.add_argument("--corpus-yaml", default="demo-data/corpus.yaml")
    parser.add_argument("--no-eval", action="store_true")
    parser.add_argument(
        "--min-sources",
        type=int,
        default=None,
        help="unabhängige Quellen für Auto-Promotion (Default: PROMOTE_MIN_SOURCES)",
    )
    parser.add_argument(
        "--confidence",
        type=float,
        default=None,
        help="Konfidenz-Schwelle für Auto-Promotion (Default: PROMOTE_CONFIDENCE)",
    )
    args = parser.parse_args(argv)
    # Ohne das schluckt der Root-Logger jede Warnung der Bibliotheksmodule und ein
    # Lauf, in dem reihenweise Papers scheitern, sieht aus wie ein sauberer.
    configure_logging()

    client = choose_client()
    report: dict = {"started_at": datetime.now(UTC).isoformat(), "llm": client.name}

    with SessionLocal() as session:
        locked = session.execute(
            text("SELECT pg_try_advisory_lock(:key)"), {"key": _LOCK_KEY}
        ).scalar_one()
        if not locked:
            log.warning("ein anderer Update-Lauf haelt die Sperre — dieser Lauf endet hier")
            return 2

        if args.since:
            queries = yaml.safe_load(Path(args.corpus_yaml).read_text(encoding="utf-8")).get(
                "queries", []
            )
            print(f"Delta-fetch since {args.since} (cap {args.cap}) …")
            # Ein 503 von arXiv darf nicht Ingest, Extraktion, Promotion und Eval
            # mitreissen — der Rest arbeitet auf dem vorhandenen Bestand weiter.
            try:
                report["fetched"] = delta_fetch(
                    queries,
                    datetime.fromisoformat(args.since).date(),
                    out=Path(args.corpus_dir),
                    cap=args.cap,
                )
            except Exception as exc:  # noqa: BLE001 — Lauf geht ohne neue Papers weiter
                log.warning("delta fetch failed, continuing without new papers: %s", exc)
                report["fetch_error"] = str(exc)

        print("Ingesting corpus …")
        ingest = ingest_path(session, Path(args.corpus_dir))
        report["ingest"] = {
            "added": ingest.added,
            "skipped": ingest.skipped,
            "chunks": ingest.chunks,
            # Ohne diese beiden sah ein Lauf, in dem 40 von 45 PDFs scheiterten,
            # genauso aus wie ein sauberer.
            "empty": ingest.empty,
            "failed": ingest.failed,
        }

        print("Extracting facts (LLM) …")
        ex = extract_corpus(
            session, chat=client.chat, token_budget=args.token_budget, limit=args.limit
        )
        report["extract"] = {
            "papers": ex.papers,
            "nodes": ex.nodes,
            "edges": ex.edges,
            "skipped": ex.skipped,
            "failed": ex.failed,
            "failed_titles": ex.failed_titles,
            "tokens_estimated": ex.tokens,
        }

        print("Promoting facts …")
        pr = promote_graph(
            session, min_sources=args.min_sources, confidence_threshold=args.confidence
        )
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
    # Exit-Code != 0, damit ein Cron-Eintrag mit `|| benachrichtigen` anschlaegt.
    # Vorher endete auch ein Lauf, in dem alles scheiterte, mit 0.
    problems = ingest.failed + ex.failed + (1 if "fetch_error" in report else 0)
    if problems:
        log.error("Lauf mit %s Problem(en) beendet — siehe %s", problems, out)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
