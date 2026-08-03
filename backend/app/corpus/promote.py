"""Rule-based promotion of pending graph facts to verified (PLAN §7 Phase 8).

A pending entity is promoted only when it is backed by **≥ 2 independent source
documents** and the extraction confidence clears a threshold. Edges are verified only
when both endpoints are verified, so the public (verified-only) graph never dangles.
Conflicting claims (reciprocal IMPROVES_ON) are flagged ``meta.disputed`` and never
auto-verified — knowledge is added, never silently overwritten (PLAN §2.7).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session, attributes

from app.core.config import get_settings
from app.db.models import GraphEdge, GraphNode

# Voreinstellung (PLAN §2.7). Über PROMOTE_MIN_SOURCES / PROMOTE_CONFIDENCE bzw. die
# CLI-Flags von app.update anpassbar — Provenienzpflicht bleibt davon unberührt.
MIN_SOURCES = 2
CONFIDENCE_THRESHOLD = 0.7
PROMOTABLE_KINDS = ("concept", "model", "dataset")


@dataclass
class PromoteStats:
    promoted_nodes: int = 0
    promoted_edges: int = 0
    disputed: int = 0


def _sources_and_confidence(edges: list[GraphEdge]) -> tuple[set[str], float]:
    sources: set[str] = set()
    max_conf = 0.0
    for e in edges:
        meta = e.meta or {}
        sources.update(meta.get("source_document_ids", []) or [])
        max_conf = max(max_conf, float(meta.get("confidence", 0.0) or 0.0))
    return sources, max_conf


def promote_graph(
    session: Session,
    *,
    min_sources: int | None = None,
    confidence_threshold: float | None = None,
) -> PromoteStats:
    """Promote well-supported pending facts. Schwellen: Argument > Env > Default."""
    settings = get_settings()
    if min_sources is None:
        min_sources = settings.promote_min_sources
    if confidence_threshold is None:
        confidence_threshold = settings.promote_confidence

    stats = PromoteStats()
    nodes = session.execute(select(GraphNode)).scalars().all()
    edges = session.execute(select(GraphEdge)).scalars().all()

    incident: dict = defaultdict(list)
    for e in edges:
        incident[e.source].append(e)
        incident[e.target].append(e)

    verified_ids = {n.id for n in nodes if n.status == "verified"}

    # 1) promote well-supported pending entity nodes
    for node in nodes:
        if node.status != "pending" or node.kind not in PROMOTABLE_KINDS:
            continue
        sources, max_conf = _sources_and_confidence(incident[node.id])
        if len(sources) >= min_sources and max_conf >= confidence_threshold:
            node.status = "verified"
            node.meta = {
                **(node.meta or {}),
                "source_document_ids": sorted(sources),
                "confidence": round(max_conf, 3),
                "promoted_at": datetime.now(UTC).isoformat(),
            }
            attributes.flag_modified(node, "meta")
            verified_ids.add(node.id)
            stats.promoted_nodes += 1

    # 2) verify edges whose both endpoints are verified; flag reciprocal IMPROVES_ON
    edge_keys = {(e.source, e.target, e.relation) for e in edges}
    for e in edges:
        if e.status != "pending" or e.source not in verified_ids or e.target not in verified_ids:
            continue
        if e.relation == "IMPROVES_ON" and (e.target, e.source, "IMPROVES_ON") in edge_keys:
            e.meta = {**(e.meta or {}), "disputed": True}
            attributes.flag_modified(e, "meta")
            stats.disputed += 1
            continue
        e.status = "verified"
        stats.promoted_edges += 1

    session.commit()
    return stats
