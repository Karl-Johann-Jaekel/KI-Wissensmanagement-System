"""Zitationsmetriken für Korpus-Papers (Semantic Scholar).

arXiv liefert keine Zitationszahlen — sie kommen aus der Graph-API von Semantic
Scholar, adressiert über die arXiv-ID. Nur **öffentliche** Papers werden
abgefragt: die Zone `confidential` verlässt den Rechner nie (PLAN §2), und
abgefragt wird ausschließlich eine bereits veröffentlichte arXiv-ID, kein Inhalt.

    python -m app.corpus.citations            # alle public arXiv-Papers auffrischen
    python -m app.corpus.citations --limit 20

Ausfälle sind unkritisch: Ist der Dienst nicht erreichbar, bleibt der Bestand
unverändert und die Anzeige fällt auf „keine Angabe" zurück.
"""

from __future__ import annotations

import argparse
import logging
from datetime import UTC, datetime

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session, attributes

from app.core.config import get_settings
from app.db.models import Document, GraphNode
from app.db.session import SessionLocal

log = logging.getLogger(__name__)

S2_BATCH_URL = "https://api.semanticscholar.org/graph/v1/paper/batch"
S2_FIELDS = "citationCount,influentialCitationCount,year,venue,title"
# Die Batch-API nimmt bis zu 500 IDs pro Aufruf; kleiner halten, damit ein
# einzelner Fehlschlag nicht den ganzen Lauf kostet.
BATCH_SIZE = 100
TIMEOUT_S = 30.0


class CitationMetrics(dict):
    """``{citations, influential, year, venue, source, fetched_at}``."""


def _batch(ids: list[str], size: int) -> list[list[str]]:
    return [ids[i : i + size] for i in range(0, len(ids), size)]


def fetch_citation_metrics(
    arxiv_ids: list[str], *, client: httpx.Client | None = None
) -> dict[str, CitationMetrics]:
    """arXiv-ID -> Metriken. Unbekannte IDs fehlen im Ergebnis; Fehler ergeben {}."""
    if not arxiv_ids:
        return {}
    settings = get_settings()
    headers = {"User-Agent": "ki-wissensmanagement-system/0.1"}
    if settings.semantic_scholar_api_key:
        headers["x-api-key"] = settings.semantic_scholar_api_key

    own = client is None
    http = client or httpx.Client(headers=headers, timeout=TIMEOUT_S, follow_redirects=True)
    out: dict[str, CitationMetrics] = {}
    now = datetime.now(UTC).isoformat()
    try:
        for chunk in _batch(arxiv_ids, BATCH_SIZE):
            try:
                resp = http.post(
                    S2_BATCH_URL,
                    params={"fields": S2_FIELDS},
                    json={"ids": [f"arXiv:{a}" for a in chunk]},
                )
                resp.raise_for_status()
                payload = resp.json()
            except (httpx.HTTPError, ValueError) as exc:
                log.warning("citation lookup failed: %s", exc)
                continue
            if not isinstance(payload, list):
                continue
            # Die Antwort ist positionsgleich zur Anfrage; None = unbekannt.
            for arxiv_id, entry in zip(chunk, payload, strict=False):
                if not isinstance(entry, dict):
                    continue
                out[arxiv_id] = CitationMetrics(
                    citations=entry.get("citationCount"),
                    influential=entry.get("influentialCitationCount"),
                    year=entry.get("year"),
                    venue=entry.get("venue") or None,
                    source="semanticscholar",
                    fetched_at=now,
                )
    finally:
        if own:
            http.close()
    return out


def refresh_citations(
    session: Session, *, limit: int | None = None, client: httpx.Client | None = None
) -> tuple[int, int]:
    """Metriken für öffentliche arXiv-Papers holen und spiegeln. -> (abgefragt, aktualisiert)."""
    docs = (
        session.execute(select(Document).where(Document.source_type == "arxiv_pdf")).scalars().all()
    )
    pairs: list[tuple[Document, str]] = [
        (d, str(arxiv_id))
        for d in docs
        if (arxiv_id := (d.meta or {}).get("id"))  # ohne arXiv-ID nicht abfragbar
    ]
    if limit is not None:
        pairs = pairs[:limit]
    if not pairs:
        return 0, 0

    metrics = fetch_citation_metrics([a for _d, a in pairs], client=client)
    updated = 0
    for doc, arxiv_id in pairs:
        m = metrics.get(arxiv_id)
        if m is None or m.get("citations") is None:
            continue
        doc.meta = {**(doc.meta or {}), "citations": dict(m)}
        attributes.flag_modified(doc, "meta")
        # Auf den Paper-Knoten spiegeln, damit /graph die Zahl ohne Join ausliefert.
        node = session.execute(
            select(GraphNode).where(GraphNode.kind == "paper", GraphNode.name == doc.title)
        ).scalar_one_or_none()
        if node is not None:
            node.meta = {**(node.meta or {}), "citations": dict(m)}
            attributes.flag_modified(node, "meta")
        updated += 1
    session.commit()
    return len(pairs), updated


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args(argv)
    with SessionLocal() as session:
        queried, updated = refresh_citations(session, limit=args.limit)
    print(f"Zitationen: {queried} Papers abgefragt, {updated} aktualisiert.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
