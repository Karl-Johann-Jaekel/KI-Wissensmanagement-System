"""CLI: ingest PDFs into the corpus (PLAN §7 Phase 3).

    python -m app.ingest data/corpus --sensitivity public
    python -m app.ingest data/private --sensitivity confidential --lang german

Idempotent (content_hash). Embeddings go through Ollama (EMBED_MODEL in .env).
"""

from __future__ import annotations

import argparse
from pathlib import Path

from app.db.models import SENSITIVITIES
from app.db.session import SessionLocal
from app.ingestion.pipeline import ingest_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Ingest PDFs into the knowledge base.")
    parser.add_argument("path", help="directory or single PDF")
    parser.add_argument(
        "--sensitivity",
        choices=SENSITIVITIES,
        default="public",
        help="data zone (default: public)",
    )
    parser.add_argument("--lang", default=None, help="english|german (else from sidecar)")
    args = parser.parse_args(argv)

    root = Path(args.path)
    if not root.exists():
        parser.error(f"path not found: {root}")

    print(f"Ingesting {root} (sensitivity={args.sensitivity}) …")
    with SessionLocal() as session:
        stats = ingest_path(session, root, args.sensitivity, args.lang)
    print(
        f"Done. added={stats.added} skipped={stats.skipped} "
        f"empty={stats.empty} failed={stats.failed} chunks={stats.chunks}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
