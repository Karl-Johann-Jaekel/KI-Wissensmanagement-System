"""Bestehende Provenienz aus JSONB in ``entities_extracted`` überführen (ADR-0020).

Vor Migration 0005 stand Herkunft in zwei JSONB-Feldern: ``meta.source_document_ids``
an dem, was die LLM-Extraktion geschrieben hat, und ``meta.provenance`` an dem, was
aus einer Fremdquelle importiert wurde. Beides bleibt stehen; dieses Skript legt die
entsprechenden Belegzeilen an, damit der Löschpfad und die Quellen-Abfrage den
**gesamten** Bestand sehen und nicht nur das, was nach der Migration geschrieben wurde.

    python scripts/backfill_provenance.py --dry-run
    python scripts/backfill_provenance.py

Idempotent: dieselben Upserts wie die regulären Schreibwege.
"""

from __future__ import annotations

import argparse
from collections import Counter

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Document, GraphEdge, GraphNode
from app.db.provenance import Claim, record_extraction, record_source

#: Extraktor-Kennung für nachgetragene Belege — als solche erkennbar, weil der
#: ursprüngliche Lauf nicht mehr rekonstruierbar ist.
LEGACY_LLM = "llm:extract"


def _source_row(session: Session, cache: dict[str, str], provenance: dict) -> str | None:
    """Quellen-Zeile für einen ``meta.provenance``-Block, einmal je Quellsystem."""
    system = str(provenance.get("source") or "").strip()
    if not system:
        return None
    if system not in cache:
        cache[system] = record_source(
            session,
            source_system=system,
            source_id="dump",
            fetched_by=str(provenance.get("fetched_by") or "backfill"),
            source_url=provenance.get("source_url"),
            license=provenance.get("license"),
            meta={"backfilled": True},
        )
    return cache[system]


def backfill(session: Session, *, dry_run: bool = False) -> Counter:
    stats: Counter = Counter()
    known_documents = {str(i) for i in session.execute(select(Document.id)).scalars()}
    cache: dict[str, str] = {}

    for node in session.execute(select(GraphNode)).scalars():
        meta = node.meta or {}
        claim = Claim(node_id=str(node.id))
        provenance = meta.get("provenance")
        if isinstance(provenance, dict):
            stats["nodes_foreign"] += 1
            if not dry_run:
                source_id = _source_row(session, cache, provenance)
                record_extraction(
                    session,
                    claim,
                    extractor=f"rule:{provenance.get('source')}",
                    source_id=source_id,
                    meta={"backfilled": True},
                )
        for doc_id in meta.get("source_document_ids") or []:
            # Verwaiste Verweise überspringen — ein gelöschtes Dokument taugt nicht
            # als Beleg, und der Fremdschlüssel würde ohnehin abweisen.
            if str(doc_id) not in known_documents:
                stats["nodes_orphan_doc"] += 1
                continue
            stats["nodes_llm"] += 1
            if not dry_run:
                record_extraction(
                    session,
                    claim,
                    extractor=LEGACY_LLM,
                    document_id=str(doc_id),
                    meta={"backfilled": True},
                )

    for edge in session.execute(select(GraphEdge)).scalars():
        meta = edge.meta or {}
        claim = Claim(edge=(str(edge.source), str(edge.target), edge.relation))
        confidence = meta.get("confidence")
        provenance = meta.get("provenance")
        if isinstance(provenance, dict):
            stats["edges_foreign"] += 1
            if not dry_run:
                source_id = _source_row(session, cache, provenance)
                record_extraction(
                    session,
                    claim,
                    extractor=f"rule:{provenance.get('source')}",
                    source_id=source_id,
                    meta={"backfilled": True},
                )
        for doc_id in meta.get("source_document_ids") or []:
            if str(doc_id) not in known_documents:
                stats["edges_orphan_doc"] += 1
                continue
            stats["edges_llm"] += 1
            if not dry_run:
                record_extraction(
                    session,
                    claim,
                    extractor=LEGACY_LLM,
                    document_id=str(doc_id),
                    confidence=float(confidence) if isinstance(confidence, int | float) else None,
                    meta={"backfilled": True},
                )

    if not dry_run:
        session.commit()
    return stats


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="nur zählen, nichts schreiben")
    args = parser.parse_args(argv)

    from app.db.session import SessionLocal

    with SessionLocal() as session:
        stats = backfill(session, dry_run=args.dry_run)
    for key in sorted(stats):
        print(f"  {key:20} {stats[key]}")
    print("dry-run — nichts geschrieben." if args.dry_run else "Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
