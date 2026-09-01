"""Idempotent graph upserts — shared by all graph writers (PLAN §2.7/§6).

UNIQUE(kind,name) / PK(source,target,relation) make writes idempotent. On conflict,
JSONB meta is merged (provenance accumulates) and ``status``/``first_seen`` are left
untouched — no silent overwrite of verified knowledge (Phase 8 promotion is a
separate, rule-based step).
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.db.models import GraphEdge, GraphNode


def upsert_node(
    session: Session,
    kind: str,
    name: str,
    meta: dict | None = None,
    *,
    status: str = "verified",
) -> str:
    ins = pg_insert(GraphNode).values(kind=kind, name=name, status=status, meta=meta or {})
    stmt = ins.on_conflict_do_update(
        index_elements=["kind", "name"],
        # Merge JSONB meta (accumulate provenance); keep existing status/first_seen.
        set_={"meta": GraphNode.meta.op("||")(ins.excluded.meta)},
    ).returning(GraphNode.id)
    return str(session.execute(stmt).scalar_one())


def upsert_edge(
    session: Session,
    source: str,
    target: str,
    relation: str,
    weight: float = 1.0,
    meta: dict | None = None,
    *,
    status: str = "verified",
) -> None:
    ins = pg_insert(GraphEdge).values(
        source=source,
        target=target,
        relation=relation,
        status=status,
        weight=weight,
        meta=meta or {},
    )
    stmt = ins.on_conflict_do_update(
        index_elements=["source", "target", "relation"],
        set_={"weight": ins.excluded.weight, "meta": GraphEdge.meta.op("||")(ins.excluded.meta)},
    )
    session.execute(stmt)


def graph_counts(session: Session) -> dict[str, int]:
    """Zählt in der Datenbank statt jede Zeile nach Python zu holen."""
    return {
        "nodes": session.execute(select(func.count()).select_from(GraphNode)).scalar_one(),
        "edges": session.execute(select(func.count()).select_from(GraphEdge)).scalar_one(),
    }
