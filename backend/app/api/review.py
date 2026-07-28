"""Review queue for pending graph facts (PLAN §7 Phase 8) — admin only.

The living-knowledge loop stages LLM-extracted facts as ``pending``; rules auto-verify
the well-supported ones, the rest land here for a human verify/reject click.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session, attributes

from app.core.security import require_admin
from app.db.models import GraphEdge, GraphNode
from app.db.session import get_db

router = APIRouter(tags=["review"], dependencies=[Depends(require_admin)])


@router.get("/review")
def list_pending(db: Session = Depends(get_db)) -> dict:
    """Pending entity nodes with their supporting-source count + confidence."""
    nodes = db.execute(select(GraphNode).where(GraphNode.status == "pending")).scalars().all()
    edges = db.execute(select(GraphEdge)).scalars().all()

    incident: dict = defaultdict(list)
    for e in edges:
        incident[e.source].append(e)
        incident[e.target].append(e)

    items = []
    for n in nodes:
        sources: set[str] = set()
        max_conf = 0.0
        for e in incident[n.id]:
            meta = e.meta or {}
            sources.update(meta.get("source_document_ids", []) or [])
            max_conf = max(max_conf, float(meta.get("confidence", 0.0) or 0.0))
        items.append(
            {
                "id": str(n.id),
                "kind": n.kind,
                "name": n.name,
                "sources": len(sources),
                "confidence": round(max_conf, 3),
                "first_seen": n.first_seen.isoformat(),
            }
        )
    items.sort(key=lambda i: (i["sources"], i["confidence"]), reverse=True)
    return {"pending": items, "count": len(items)}


@router.post("/review/node/{node_id}")
def review_node(
    node_id: str,
    action: Literal["verify", "reject"],
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    node = db.get(GraphNode, uuid.UUID(node_id))
    if node is None:
        raise HTTPException(status_code=404, detail="node not found")

    if action == "reject":
        node.status = "rejected"
        db.commit()
        return {"id": node_id, "status": "rejected"}

    # verify: attach provenance from incident edges, then verify edges to verified nodes
    edges = (
        db.execute(
            select(GraphEdge).where((GraphEdge.source == node.id) | (GraphEdge.target == node.id))
        )
        .scalars()
        .all()
    )
    sources: set[str] = set()
    for e in edges:
        sources.update((e.meta or {}).get("source_document_ids", []) or [])
    node.status = "verified"
    node.meta = {
        **(node.meta or {}),
        "source_document_ids": sorted(sources),
        "verified_at": datetime.now(UTC).isoformat(),
    }
    attributes.flag_modified(node, "meta")

    verified_ids = {
        n.id for n in db.execute(select(GraphNode).where(GraphNode.status == "verified")).scalars()
    }
    verified_edges = 0
    for e in edges:
        if e.status == "pending" and e.source in verified_ids and e.target in verified_ids:
            e.status = "verified"
            verified_edges += 1
    db.commit()
    return {"id": node_id, "status": "verified", "edges_verified": verified_edges}
