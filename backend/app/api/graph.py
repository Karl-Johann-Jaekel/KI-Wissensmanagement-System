"""GET /graph — knowledge graph (papers/concepts/models/datasets) for react-force-graph.

Public view shows only ``verified`` facts; ``include_pending=true`` (Review-Queue,
Phase 8) also returns pending ones. ``val`` is the summed incident edge weight so the
frontend can size nodes.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import require_admin
from app.db.models import GraphEdge, GraphNode
from app.db.session import get_db

router = APIRouter(tags=["graph"])

# ``repo``/``task`` kommen aus dem Papers-with-Code-Import (ADR-0017).
KNOWLEDGE_KINDS = ("paper", "concept", "model", "dataset", "task", "repo")

#: Obergrenze der ausgelieferten Knoten. Der PwC-Dump kann den Graphen auf
#: Zehntausende Knoten heben; ungebremst friert das die Force-Simulation ein.
DEFAULT_NODE_LIMIT = 2000


def _cap_by_kind(nodes: Sequence[GraphNode], val: dict[str, float], limit: int) -> list[GraphNode]:
    """Auf ``limit`` Knoten kappen, ohne eine Knotenart auszulöschen.

    Rein nach Vernetzungsgrad zu kappen bevorzugt strukturell die Naben: Nach dem
    Papers-with-Code-Import überlebten von 4.600 Code-Repos genau zwei, weil ein Repo
    per Definition an genau einem Paper hängt. Jede Art bekommt deshalb ein Kontingent
    im Verhältnis ihres Bestands (mindestens eines) und füllt es mit ihren
    bestvernetzten Knoten; ungenutzte Plätze gehen an den Rest nach Grad.
    """
    by_kind: dict[str, list[GraphNode]] = defaultdict(list)
    for node in nodes:
        by_kind[node.kind].append(node)

    def rank(node: GraphNode) -> tuple[float, str]:
        return (-val.get(str(node.id), 0.0), node.name)

    keep: list[GraphNode] = []
    leftovers: list[GraphNode] = []
    for kind_nodes in by_kind.values():
        quota = max(1, round(limit * len(kind_nodes) / len(nodes)))
        ranked = sorted(kind_nodes, key=rank)
        keep.extend(ranked[:quota])
        leftovers.extend(ranked[quota:])

    if len(keep) > limit:
        keep = sorted(keep, key=rank)[:limit]
    elif len(keep) < limit:
        keep.extend(sorted(leftovers, key=rank)[: limit - len(keep)])
    return keep


@router.get("/graph")
def get_graph(
    request: Request,
    include_pending: bool = Query(default=False, description="also return pending facts"),
    source: str | None = Query(
        default=None,
        description="filter by meta.provenance.source, e.g. paperswithcode; 'native' = ohne",
    ),
    limit: int = Query(default=DEFAULT_NODE_LIMIT, ge=1, le=20000),
    db: Session = Depends(get_db),
) -> dict[str, list[dict]]:
    if include_pending:
        # pending = ungeprüfte LLM-Extraktion — nur Admin (schließt bisherigen Leak).
        require_admin(request)
    node_q = select(GraphNode).where(GraphNode.kind.in_(KNOWLEDGE_KINDS))
    if not include_pending:
        node_q = node_q.where(GraphNode.status == "verified")
    if source:
        provenance = GraphNode.meta["provenance"]["source"].astext
        node_q = node_q.where(provenance.is_(None) if source == "native" else provenance == source)
    nodes = db.execute(node_q).scalars().all()
    node_ids = {n.id for n in nodes}

    edges = db.execute(select(GraphEdge)).scalars().all()
    edges = [e for e in edges if e.source in node_ids and e.target in node_ids]
    if not include_pending:
        edges = [e for e in edges if e.status == "verified"]

    val: dict[str, float] = defaultdict(float)
    for e in edges:
        val[str(e.source)] += e.weight
        val[str(e.target)] += e.weight

    if len(nodes) > limit:
        nodes = _cap_by_kind(nodes, val, limit)
        node_ids = {n.id for n in nodes}
        edges = [e for e in edges if e.source in node_ids and e.target in node_ids]

    landmark_min = get_settings().citation_landmark_min

    def _citations(node: GraphNode) -> int | None:
        raw = (node.meta or {}).get("citations") or {}
        count = raw.get("citations")
        return int(count) if isinstance(count, int | float) else None

    return {
        "nodes": [
            {
                "id": str(n.id),
                "kind": n.kind,
                "name": n.name,
                "status": n.status,
                "first_seen": n.first_seen.isoformat(),
                "val": round(val.get(str(n.id), 0.0), 4) or 1.0,
                # Zitationszahl als eigenes Signal — die Knotengröße kodiert bereits
                # den Vernetzungsgrad und bleibt davon unberührt (ADR-0013).
                "citations": _citations(n),
                "landmark": (_citations(n) or 0) >= landmark_min,
                "meta": n.meta,
            }
            for n in nodes
        ],
        "links": [
            {
                "source": str(e.source),
                "target": str(e.target),
                "relation": e.relation,
                "weight": e.weight,
                "status": e.status,
            }
            for e in edges
        ],
    }


@router.get("/graph/changelog")
def changelog(
    days: int = Query(default=7, ge=1, le=365),
    db: Session = Depends(get_db),
) -> dict:
    """Verified knowledge-graph nodes first seen within the last `days` — "Neu"-Feed."""
    since = datetime.now(UTC) - timedelta(days=days)
    rows = (
        db.execute(
            select(GraphNode)
            .where(
                GraphNode.kind.in_(KNOWLEDGE_KINDS),
                GraphNode.status == "verified",
                GraphNode.first_seen >= since,
            )
            .order_by(GraphNode.first_seen.desc())
        )
        .scalars()
        .all()
    )
    return {
        "days": days,
        "count": len(rows),
        "items": [
            {
                "id": str(n.id),
                "kind": n.kind,
                "name": n.name,
                "first_seen": n.first_seen.isoformat(),
            }
            for n in rows
        ],
    }
