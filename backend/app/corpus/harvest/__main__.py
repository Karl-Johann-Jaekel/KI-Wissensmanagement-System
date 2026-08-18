"""CLI der Quellen-Harvester (PLAN §7 Phase 11.3).

    python -m app.corpus.harvest --source arxiv --since 2026-08-01 --cap 200
    python -m app.corpus.harvest --source arxiv          # seit dem letzten Lauf
    python -m app.corpus.harvest --source openreview --venue ICLR.cc/2025/Conference

Der Lauf ist wiederaufnehmbar: Zeitmarke und Blätter-Zeiger stehen in
``data/harvest/state.json``. Ohne ``--since`` beginnt er dort, wo der letzte
aufgehört hat; beim allerersten Mal ist ``--since`` Pflicht — sonst zöge der
Harvester das gesamte Archiv.
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import UTC, date, datetime
from pathlib import Path

import httpx

from app.corpus.harvest import arxiv_oai, openreview
from app.corpus.harvest.base import (
    USER_AGENT,
    Deduper,
    HarvestError,
    HarvestState,
    HarvestStats,
    JsonlSink,
    SourceState,
    utc_now,
)
from app.corpus.harvest.oai import StaleResumptionToken

DEFAULT_OUT = Path("data/harvest")
STATE_FILE = "state.json"


def _load_seen(out_dir: Path) -> Deduper:
    """Dedupe-Index aus den bisherigen Ernten aufbauen.

    Quellenübergreifend: Dieselbe Arbeit auf arXiv und OpenReview soll beim zweiten
    Fund als Dublette auffallen, nicht zweimal im Bestand landen.
    """
    import json

    dois: list[str] = []
    titles: list[str] = []
    for path in sorted(out_dir.glob("*.jsonl")):
        with path.open(encoding="utf-8") as handle:
            for line in handle:
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if row.get("doi"):
                    dois.append(row["doi"])
                if row.get("title"):
                    titles.append(row["title"])
    return Deduper(dois, titles)


def _resolve_since(args: argparse.Namespace, state: SourceState) -> date | str:
    if args.since:
        return datetime.fromisoformat(args.since).date()
    if state.cursor:
        return state.cursor
    raise SystemExit(
        "Kein Fortschritt gespeichert — beim ersten Lauf --since setzen "
        "(sonst würde das gesamte Archiv geholt)."
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, choices=("arxiv", "openreview"))
    parser.add_argument("--since", default=None, help="ISO-Datum; sonst ab letztem Lauf")
    parser.add_argument("--until", default=None, help="ISO-Datum (nur arxiv)")
    parser.add_argument("--cap", type=int, default=None, help="max. Datensätze pro Lauf")
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="Zielverzeichnis")
    parser.add_argument(
        "--venue",
        action="append",
        default=[],
        help="OpenReview-Venue-Id (mehrfach möglich)",
    )
    parser.add_argument("--fresh", action="store_true", help="Blätter-Zeiger verwerfen")
    args = parser.parse_args(argv)

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    state = HarvestState(out_dir / STATE_FILE)
    source_state = state.get(args.source)
    resume = None if args.fresh else source_state.resume
    stats = HarvestStats()

    # Zeitmarke des Laufs vorab festhalten: Sie ist der Startpunkt des nächsten
    # Deltas, auch wenn dieser Lauf abbricht.
    run_started = datetime.now(UTC).date().isoformat()
    latest_token: str | None = None

    def remember(token: str | None) -> None:
        nonlocal latest_token
        latest_token = token

    with JsonlSink(out_dir / f"{args.source}.jsonl") as sink:
        deduper = _load_seen(out_dir)
        print(f"Dedupe-Index: {len(deduper)} Schlüssel aus bisherigen Ernten")
        try:
            if args.source == "arxiv":
                arxiv_oai.harvest(
                    since=_resolve_since(args, source_state),
                    until=args.until,
                    sink=sink,
                    deduper=deduper,
                    stats=stats,
                    cap=args.cap,
                    resume=resume,
                    on_page=remember,
                    fetched_by=USER_AGENT,
                )
            else:
                _harvest_openreview(args, source_state, sink, deduper, stats, remember)
        except StaleResumptionToken:
            print("Blätter-Zeiger abgelaufen — nächster Lauf beginnt beim Zeitfilter neu")
            latest_token = None
        except HarvestError as exc:
            print(f"Abbruch: {exc}", file=sys.stderr)
            _save(state, args.source, source_state, run_started, latest_token, stats)
            return 1

    _save(state, args.source, source_state, run_started, latest_token, stats)
    print(f"Done. {stats.as_dict()}")
    return 0


def _harvest_openreview(
    args: argparse.Namespace,
    source_state: SourceState,
    sink: JsonlSink,
    deduper: Deduper,
    stats: HarvestStats,
    remember: object,
) -> None:
    if not args.venue:
        raise SystemExit("--venue ist für OpenReview Pflicht (z. B. ICLR.cc/2025/Conference)")
    user = os.environ.get("OPENREVIEW_USERNAME")
    secret = os.environ.get("OPENREVIEW_PASSWORD")
    if not (user and secret):
        raise SystemExit(
            "OpenReview verlangt seit 2026 ein Konto (Browser-Challenge für anonyme "
            "Zugriffe). OPENREVIEW_USERNAME und OPENREVIEW_PASSWORD setzen."
        )
    with httpx.Client(
        headers={"User-Agent": USER_AGENT}, timeout=120.0, follow_redirects=True
    ) as client:
        token = openreview.login(client, user, secret)
        client.headers["Authorization"] = f"Bearer {token}"
        openreview.harvest(
            venue_ids=tuple(args.venue),
            since=args.since or source_state.cursor,
            sink=sink,
            client=client,
            deduper=deduper,
            stats=stats,
            cap=args.cap,
            on_page=remember,  # type: ignore[arg-type]
        )


def _save(
    state: HarvestState,
    source: str,
    previous: SourceState,
    cursor: str,
    resume: str | None,
    stats: HarvestStats,
) -> None:
    state.set(
        source,
        SourceState(
            # Nur weiterrücken, wenn nichts mehr offen ist — sonst überspringt der
            # nächste Lauf genau die Seiten, die dieser nicht mehr geschafft hat.
            cursor=previous.cursor if resume else cursor,
            resume=resume,
            last_run=utc_now(),
            records=previous.records + stats.records,
        ),
    )
    state.save()


if __name__ == "__main__":
    raise SystemExit(main())
