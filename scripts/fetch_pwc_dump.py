"""Papers-with-Code-Dump von Hugging Face holen (ADR-0017).

Der ursprüngliche Host (`production-media.paperswithcode.com`) ist mit der
Abschaltung Mitte 2025 verschwunden. Das offizielle Archiv liegt seither unter
der Organisation `pwc-archive` auf Hugging Face — als **Parquet-Shards**, nicht
mehr als `.json.gz`. Lizenz unverändert CC-BY-SA-4.0.

    python scripts/fetch_pwc_dump.py --out data/pwc
    python scripts/fetch_pwc_dump.py --out data/pwc --only links datasets

Lädt idempotent: vorhandene Dateien mit passender Größe werden übersprungen, ein
abgebrochener Teil-Download wird neu geholt (kein Range-Resume — die Shards sind
klein genug, ein halber Parquet-Block wäre schlimmer als ein zweiter Versuch).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import httpx

HF_API = "https://huggingface.co/api/datasets"
HF_RESOLVE = "https://huggingface.co/datasets/{repo}/resolve/main/{path}"

#: lokaler Dateiname-Stamm -> Hugging-Face-Repo. Die Stämme sind die Namen, unter
#: denen ``app.corpus.pwc`` die Dateien erwartet (DUMP_STEMS).
REPOS = {
    "papers-with-abstracts": "pwc-archive/papers-with-abstracts",
    "links-between-papers-and-code": "pwc-archive/links-between-paper-and-code",
    "evaluation-tables": "pwc-archive/evaluation-tables",
    "datasets": "pwc-archive/datasets",
    "methods": "pwc-archive/methods",
}

USER_AGENT = "ki-wissensmanagement-system/0.1 (pwc archive fetch; contact via repo)"
CHUNK = 1 << 20


def list_shards(client: httpx.Client, repo: str) -> list[str]:
    """Parquet-Dateien eines Datensatz-Repos (in stabiler Reihenfolge)."""
    resp = client.get(f"{HF_API}/{repo}")
    resp.raise_for_status()
    files = [s["rfilename"] for s in resp.json().get("siblings", [])]
    return sorted(f for f in files if f.endswith(".parquet"))


def download(client: httpx.Client, url: str, target: Path) -> str:
    """Eine Datei laden. Gibt "skipped" oder "downloaded" zurück."""
    head = client.head(url)
    head.raise_for_status()
    expected = int(head.headers.get("content-length", 0))
    if target.exists() and expected and target.stat().st_size == expected:
        return "skipped"

    # Erst in eine .part-Datei, dann umbenennen: ein Abbruch hinterlässt kein
    # halbes Parquet, das der Import später für vollständig hält.
    part = target.with_suffix(target.suffix + ".part")
    done = 0
    with client.stream("GET", url) as resp:
        resp.raise_for_status()
        with part.open("wb") as fh:
            for block in resp.iter_bytes(CHUNK):
                fh.write(block)
                done += len(block)
                if expected:
                    pct = 100 * done / expected
                    print(f"\r    {target.name}: {pct:5.1f}%  ", end="", flush=True)
    print()
    part.replace(target)
    return "downloaded"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default="data/pwc", help="Zielverzeichnis")
    parser.add_argument(
        "--only",
        nargs="*",
        default=None,
        help=f"nur diese Stämme laden (aus: {', '.join(REPOS)})",
    )
    args = parser.parse_args(argv)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    wanted = args.only or list(REPOS)
    unknown = [w for w in wanted if w not in REPOS]
    if unknown:
        parser.error(f"unbekannt: {', '.join(unknown)}")

    total_bytes = 0
    with httpx.Client(
        headers={"User-Agent": USER_AGENT}, timeout=120.0, follow_redirects=True
    ) as client:
        for stem in wanted:
            repo = REPOS[stem]
            print(f"  {stem}  ({repo})")
            shards = list_shards(client, repo)
            if not shards:
                print("    ! keine Parquet-Dateien gefunden", file=sys.stderr)
                continue
            for index, path in enumerate(shards):
                # Ein Shard -> "<stem>.parquet", mehrere -> "<stem>.00.parquet" usw.
                name = f"{stem}.parquet" if len(shards) == 1 else f"{stem}.{index:02d}.parquet"
                target = out / name
                status = download(client, HF_RESOLVE.format(repo=repo, path=path), target)
                total_bytes += target.stat().st_size
                if status == "skipped":
                    print(f"    = {name} (vorhanden)")
    print(f"Done. {total_bytes / 1e6:.0f} MB in {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
