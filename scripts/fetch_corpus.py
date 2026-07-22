"""Fetch arXiv seed papers listed in demo-data/corpus.yaml into data/corpus/.

PLAN §2.5 / §7 Phase 3: PDFs are never committed (arXiv licence) — this script pulls
them at runtime plus a metadata sidecar (<id>.json). Rate-limit friendly: one request
per ~3s, explicit User-Agent (PLAN §11 arXiv rate limits).

    python scripts/fetch_corpus.py [--limit N] [--out data/corpus] [--force]

Idempotent: skips papers whose PDF already exists (unless --force).
"""

from __future__ import annotations

import argparse
import json
import time
import xml.etree.ElementTree as ET
from pathlib import Path

import httpx
import yaml

ARXIV_API = "http://export.arxiv.org/api/query"
NS = {"atom": "http://www.w3.org/2005/Atom", "arxiv": "http://arxiv.org/schemas/atom"}
USER_AGENT = "ki-wissensmanagement-system/0.1 (corpus fetch; contact via repo)"
POLITE_DELAY_S = 3.0


def _text(el: ET.Element | None) -> str:
    return (el.text or "").strip() if el is not None else ""


def parse_entry(entry: ET.Element) -> dict:
    authors = [_text(a.find("atom:name", NS)) for a in entry.findall("atom:author", NS)]
    categories = [c.attrib.get("term", "") for c in entry.findall("atom:category", NS)]
    pdf_url = ""
    for link in entry.findall("atom:link", NS):
        if link.attrib.get("title") == "pdf" or link.attrib.get("type") == "application/pdf":
            pdf_url = link.attrib.get("href", "")
    abs_url = _text(entry.find("atom:id", NS))
    return {
        "title": " ".join(_text(entry.find("atom:title", NS)).split()),
        "authors": authors,
        "published": _text(entry.find("atom:published", NS)),
        "categories": categories,
        "abstract": " ".join(_text(entry.find("atom:summary", NS)).split()),
        "pdf_url": pdf_url,
        "uri": abs_url,
    }


def fetch_metadata(client: httpx.Client, arxiv_id: str) -> dict | None:
    resp = client.get(ARXIV_API, params={"id_list": arxiv_id})
    resp.raise_for_status()
    root = ET.fromstring(resp.text)
    entry = root.find("atom:entry", NS)
    if entry is None or not _text(entry.find("atom:id", NS)):
        return None
    return parse_entry(entry)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", default="demo-data/corpus.yaml")
    parser.add_argument("--out", default="data/corpus")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args(argv)

    spec = yaml.safe_load(Path(args.corpus).read_text(encoding="utf-8"))
    seeds = spec.get("seed_papers", [])
    if args.limit:
        seeds = seeds[: args.limit]

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    fetched = skipped = failed = 0
    with httpx.Client(
        headers={"User-Agent": USER_AGENT}, timeout=60.0, follow_redirects=True
    ) as client:
        for i, paper in enumerate(seeds):
            arxiv_id = str(paper["id"])
            pdf_path = out / f"{arxiv_id}.pdf"
            if pdf_path.exists() and not args.force:
                skipped += 1
                continue
            if i > 0:
                time.sleep(POLITE_DELAY_S)
            try:
                meta = fetch_metadata(client, arxiv_id)
                if meta is None or not meta["pdf_url"]:
                    print(f"  ! {arxiv_id}: no metadata/pdf link")
                    failed += 1
                    continue
                time.sleep(POLITE_DELAY_S)
                pdf = client.get(meta["pdf_url"])
                pdf.raise_for_status()
                pdf_path.write_bytes(pdf.content)
                sidecar = {"id": arxiv_id, "source_type": "arxiv_pdf", "lang": "english", **meta}
                (out / f"{arxiv_id}.json").write_text(
                    json.dumps(sidecar, indent=2, ensure_ascii=False), encoding="utf-8"
                )
                print(f"  ✓ {arxiv_id}  {meta['title'][:70]}")
                fetched += 1
            except (httpx.HTTPError, ET.ParseError) as exc:
                print(f"  ! {arxiv_id}: {exc}")
                failed += 1

    print(f"Done. fetched={fetched} skipped={skipped} failed={failed} -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
