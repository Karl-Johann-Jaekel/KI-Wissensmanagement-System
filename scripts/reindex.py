"""Chunks mit dem konfigurierten Embedding-Modell neu einbetten (PLAN §7, ADR-0014).

Nötig beim Wechsel des Modells oder des Anbieters — etwa wenn der öffentliche
Server ohne Ollama auskommen muss und auf ``mistral-embed`` umgestellt wird.
Der Text der Chunks bleibt unverändert; nur ``embedding`` und ``embed_model``
werden ersetzt.

    docker compose exec backend python scripts/reindex.py --dry-run
    docker compose exec backend python scripts/reindex.py

Fortsetzbar: Bereits auf das Zielmodell umgestellte Chunks werden übersprungen,
ein Abbruch kostet also höchstens den laufenden Stapel. Die Dimension wird gegen
EMBED_DIM geprüft, bevor irgendetwas geschrieben wird — ein Modell mit anderer
Dimension bräuchte eine Migration und wird hier abgelehnt.
"""

from __future__ import annotations

import argparse
import sys

from sqlalchemy import func, select

from app.core.config import get_settings
from app.db.models import Chunk
from app.db.session import SessionLocal
from app.ingestion.embedding import embed_texts

BATCH = 64


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batch", type=int, default=BATCH)
    parser.add_argument("--limit", type=int, default=None, help="max Chunks in diesem Lauf")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    settings = get_settings()
    target_model = settings.embed_model
    print(f"Zielmodell: {target_model} ({settings.embed_provider}, {settings.embed_dim} dim)")

    with SessionLocal() as session:
        stmt = select(Chunk).where(Chunk.embed_model != target_model).order_by(Chunk.id)
        count_stmt = select(func.count()).select_from(stmt.subquery())
        todo = session.execute(count_stmt).scalar_one()
        total = session.execute(select(func.count()).select_from(Chunk)).scalar_one()
        print(f"Chunks gesamt: {total}  |  neu einzubetten: {todo}")
        if args.dry_run or todo == 0:
            return 0

        done = 0
        while True:
            chunks = session.execute(stmt.limit(args.batch)).scalars().all()
            if not chunks:
                break
            vectors = embed_texts([c.content for c in chunks], batch_size=args.batch)
            for vec in vectors:
                if len(vec) != settings.embed_dim:
                    print(
                        f"ABBRUCH: Modell liefert {len(vec)} Dimensionen, "
                        f"EMBED_DIM ist {settings.embed_dim} — Migration nötig.",
                        file=sys.stderr,
                    )
                    return 1
            for chunk, vec in zip(chunks, vectors, strict=True):
                chunk.embedding = vec
                chunk.embed_model = target_model
            session.commit()
            done += len(chunks)
            print(f"  {done}/{todo} Chunks neu eingebettet")
            if args.limit is not None and done >= args.limit:
                break

    print("Fertig.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
