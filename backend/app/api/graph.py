"""GET /graph — knowledge graph (papers/concepts/models/datasets) for react-force-graph.

Public view shows only ``verified`` facts; ``include_pending=true`` (Review-Queue,
Phase 8) also returns pending ones. ``val`` is the summed incident edge weight so the
frontend can size nodes.
"""

from __future__ import annotations

from collections import defaultdict

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import GraphEdge, GraphNode
from app.db.session import get_db

router = APIRouter(tags=["graph"])

KNOWLEDGE_KINDS = ("paper", "concept", "model", "dataset")


@router.get("/graph")
def get_graph(
    include_pending: bool = Query(default=False, description="also return pending facts"),
    db: Session = Depends(get_db),
) -> dict[str, list[dict]]:
    node_q = select(GraphNode).where(GraphNode.kind.in_(KNOWLEDGE_KINDS))
    if not include_pending:
        node_q = node_q.where(GraphNode.status == "verified")
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

    return {
        "nodes": [
            {
                "id": str(n.id),
                "kind": n.kind,
                "name": n.name,
                "status": n.status,
                "first_seen": n.first_seen.isoformat(),
                "val": round(val.get(str(n.id), 0.0), 4) or 1.0,
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
