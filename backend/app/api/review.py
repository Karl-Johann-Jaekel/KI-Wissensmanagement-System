"""Review queue for pending graph facts (PLAN §7 Phase 8) — admin only.

The living-knowledge loop stages LLM-extracted facts as ``pending``; rules auto-verify
the well-supported ones, the rest land here for a human verify/reject click.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, attributes

from app.core.security import require_admin
from app.db.models import GraphEdge, GraphNode
from app.db.session import get_db

router = APIRouter(tags=["review"], dependencies=[Depends(require_admin)])

MAX_BULK = 500


@router.get("/review")
def list_pending(
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> dict:
    """Pending entity nodes with their supporting-source count + confidence."""
    nodes = (
        db.execute(
            select(GraphNode)
            .where(GraphNode.status == "pending")
            .order_by(GraphNode.first_seen.desc())
            .limit(limit)
            .offset(offset)
        )
        .scalars()
        .all()
    )
    node_ids = [n.id for n in nodes]

    # Nur die Kanten der angezeigten Knoten. Vorher lud diese Ansicht die
    # komplette Kantentabelle — bei 25.000 Kanten je Aufruf, um ein paar
    # Dutzend Zeilen zu zeigen.
    edges = (
        db.execute(
            select(GraphEdge).where(
                (GraphEdge.source.in_(node_ids)) | (GraphEdge.target.in_(node_ids))
            )
        )
        .scalars()
        .all()
        if node_ids
        else []
    )

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
    gesamt = db.execute(
        select(func.count()).select_from(GraphNode).where(GraphNode.status == "pending")
    ).scalar_one()
    # ``count`` bleibt die Zahl der gelieferten Zeilen (unveränderter Vertrag),
    # ``total`` sagt, wie viele es insgesamt gibt.
    return {"pending": items, "count": len(items), "total": gesamt}


def _verify_nodes(db: Session, nodes: list[GraphNode]) -> int:
    """Verify nodes, attach provenance, then verify edges between verified endpoints.

    Kanten werden in einem Durchgang für alle Knoten geprüft — dadurch kostet eine
    Sammelfreigabe genauso viele Abfragen wie eine Einzelfreigabe.
    """
    edges = db.execute(select(GraphEdge)).scalars().all()
    incident: dict = defaultdict(list)
    for e in edges:
        incident[e.source].append(e)
        incident[e.target].append(e)

    now = datetime.now(UTC).isoformat()
    for node in nodes:
        sources: set[str] = set()
        for e in incident[node.id]:
            sources.update((e.meta or {}).get("source_document_ids", []) or [])
        node.status = "verified"
        node.meta = {
            **(node.meta or {}),
            "source_document_ids": sorted(sources),
            "verified_at": now,
        }
        attributes.flag_modified(node, "meta")
    db.flush()

    verified_ids = set(
        db.execute(select(GraphNode.id).where(GraphNode.status == "verified")).scalars()
    )
    verified_edges = 0
    for e in edges:
        if e.status == "pending" and e.source in verified_ids and e.target in verified_ids:
            e.status = "verified"
            verified_edges += 1
    db.commit()
    return verified_edges


@router.post("/review/node/{node_id}")
def review_node(
    node_id: str,
    action: Literal["verify", "reject"],
    db: Session = Depends(get_db),
) -> dict:
    node = db.get(GraphNode, uuid.UUID(node_id))
    if node is None:
        raise HTTPException(status_code=404, detail="node not found")

    if action == "reject":
        node.status = "rejected"
        db.commit()
        return {"id": node_id, "status": "rejected"}

    verified_edges = _verify_nodes(db, [node])
    return {"id": node_id, "status": "verified", "edges_verified": verified_edges}


class BulkReview(BaseModel):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=MAX_BULK)
    action: Literal["verify", "reject"]


@router.post("/review/bulk")
def review_bulk(body: BulkReview, db: Session = Depends(get_db)) -> dict:
    """Sammelfreigabe/-ablehnung mehrerer pending-Fakten in einem Aufruf."""
    nodes = db.execute(select(GraphNode).where(GraphNode.id.in_(body.ids))).scalars().all()
    found = {n.id for n in nodes}
    missing = [str(i) for i in body.ids if i not in found]

    if body.action == "reject":
        for node in nodes:
            node.status = "rejected"
        db.commit()
        return {
            "action": "reject",
            "processed": len(nodes),
            "edges_verified": 0,
            "not_found": missing,
        }

    verified_edges = _verify_nodes(db, list(nodes))
    return {
        "action": "verify",
        "processed": len(nodes),
        "edges_verified": verified_edges,
        "not_found": missing,
    }
