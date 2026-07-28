"""Delta-fetch new arXiv papers for the corpus queries (PLAN §7 Phase 8).

Fetches the newest papers for each topic query in ``demo-data/corpus.yaml`` that were
submitted on/after ``--since``, capped per run (cost control, PLAN §11). PDFs land in
``data/corpus/`` with metadata sidecars — the same shape the Phase-3 pipeline ingests
(idempotent, so re-fetching is safe). Rate-limit friendly (delay + User-Agent).

    python -m app.corpus.arxiv --since 2026-07-01 --cap 5
"""

from __future__ import annotations

import argparse
import json
import time
import xml.etree.ElementTree as ET
from datetime import date, datetime
from pathlib import Path

import httpx
import yaml

ARXIV_API = "http://export.arxiv.org/api/query"
NS = {"atom": "http://www.w3.org/2005/Atom"}
USER_AGENT = "ki-wissensmanagement-system/0.1 (delta fetch; contact via repo)"
POLITE_DELAY_S = 3.0


def _text(el: ET.Element | None) -> str:
    return (el.text or "").strip() if el is not None else ""


def _entry_to_meta(entry: ET.Element) -> dict:
    arxiv_url = _text(entry.find("atom:id", NS))
    arxiv_id = arxiv_url.rsplit("/", 1)[-1].split("v")[0] if arxiv_url else ""
    pdf_url = ""
    for link in entry.findall("atom:link", NS):
        if link.attrib.get("title") == "pdf" or link.attrib.get("type") == "application/pdf":
            pdf_url = link.attrib.get("href", "")
    return {
        "id": arxiv_id,
        "source_type": "arxiv_pdf",
        "lang": "english",
        "title": " ".join(_text(entry.find("atom:title", NS)).split()),
        "authors": [_text(a.find("atom:name", NS)) for a in entry.findall("atom:author", NS)],
        "published": _text(entry.find("atom:published", NS)),
        "categories": [c.attrib.get("term", "") for c in entry.findall("atom:category", NS)],
        "abstract": " ".join(_text(entry.find("atom:summary", NS)).split()),
        "pdf_url": pdf_url,
        "uri": arxiv_url,
    }


def delta_fetch(
    queries: list[str],
    since: date,
    *,
    out: Path,
    cap: int = 10,
    per_query: int = 10,
    client: httpx.Client | None = None,
) -> list[str]:
    """Fetch new papers submitted on/after `since`. Returns the list of fetched arXiv ids."""
    out.mkdir(parents=True, exist_ok=True)
    own = client is None
    http = client or httpx.Client(
        headers={"User-Agent": USER_AGENT}, timeout=60.0, follow_redirects=True
    )
    fetched: list[str] = []
    try:
        for qi, query in enumerate(queries):
            if len(fetched) >= cap:
                break
            if qi > 0:
                time.sleep(POLITE_DELAY_S)
            resp = http.get(
                ARXIV_API,
                params={
                    "search_query": f"all:{query}",
                    "sortBy": "submittedDate",
                    "sortOrder": "descending",
                    "max_results": per_query,
                },
            )
            resp.raise_for_status()
            for entry in ET.fromstring(resp.text).findall("atom:entry", NS):
                if len(fetched) >= cap:
                    break
                meta = _entry_to_meta(entry)
                if not meta["id"] or not meta["pdf_url"]:
                    continue
                published = meta["published"][:10]
                if published and datetime.fromisoformat(published).date() < since:
                    continue
                pdf_path = out / f"{meta['id']}.pdf"
                if pdf_path.exists():
                    continue
                time.sleep(POLITE_DELAY_S)
                pdf = http.get(meta["pdf_url"])
                pdf.raise_for_status()
                pdf_path.write_bytes(pdf.content)
                (out / f"{meta['id']}.json").write_text(
                    json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8"
                )
                fetched.append(meta["id"])
                print(f"  ✓ {meta['id']}  {meta['title'][:60]}")
    finally:
        if own:
            http.close()
    return fetched


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--since", required=True, help="ISO date, e.g. 2026-07-01")
    parser.add_argument("--cap", type=int, default=10)
    parser.add_argument("--corpus", default="demo-data/corpus.yaml")
    parser.add_argument("--out", default="data/corpus")
    args = parser.parse_args(argv)

    spec = yaml.safe_load(Path(args.corpus).read_text(encoding="utf-8"))
    since = datetime.fromisoformat(args.since).date()
    fetched = delta_fetch(spec.get("queries", []), since, out=Path(args.out), cap=args.cap)
    print(f"Done. {len(fetched)} new papers since {since}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
