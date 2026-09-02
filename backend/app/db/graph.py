"""Idempotent graph upserts — shared by all graph writers (PLAN §2.7/§6).

UNIQUE(kind,name) / PK(source,target,relation) make writes idempotent. On conflict,
JSONB meta is merged and ``status``/``first_seen`` are left untouched — no silent
overwrite of verified knowledge (Phase 8 promotion is a separate, rule-based step).

Zur Zusammenführung von ``meta``: ``||`` ist ein **flacher** Merge, bei gleichem
Schlüssel gewinnt die rechte Seite. Für ``source_document_ids`` ist das falsch —
behaupten zwei Papers dieselbe Kante, trafen beide denselben Primärschlüssel und
die Quelle des ersten verschwand. Genau davon lebt aber die 2-Quellen-Regel der
Promotion. Diese eine Liste wird deshalb vereinigt statt ersetzt.

``weight`` und ``meta.confidence`` wachsen nur noch: eine spätere Extraktion mit
0,5 senkte sonst still eine zuvor mit 0,95 geschriebene Kante ab.
"""

from __future__ import annotations

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.db.models import GraphEdge, GraphNode


def _merge_meta(table: str, *, monotonic_confidence: bool = False) -> object:
    """``meta``-Zusammenführung für ON CONFLICT: flacher Merge, Quellen vereinigt.

    Fester, parametrisierter Ausdruck — kein zur Laufzeit erzeugtes SQL. Der
    CASE-Zweig sorgt dafür, dass ``source_document_ids`` nicht auftaucht, wenn
    keine Seite den Schlüssel trägt.
    """
    confidence = ""
    if monotonic_confidence:
        confidence = f"""
          || CASE WHEN ({table}.meta ? 'confidence' OR excluded.meta ? 'confidence')
                  THEN jsonb_build_object('confidence', greatest(
                         COALESCE(({table}.meta->>'confidence')::float8, 0),
                         COALESCE((excluded.meta->>'confidence')::float8, 0)))
                  ELSE '{{}}'::jsonb
             END"""
    return text(
        f"""
        CASE WHEN ({table}.meta ? 'source_document_ids'
                   OR excluded.meta ? 'source_document_ids')
             THEN ({table}.meta || excluded.meta)
                  || jsonb_build_object('source_document_ids', (
                       SELECT jsonb_agg(DISTINCT e ORDER BY e)
                       FROM jsonb_array_elements(
                              COALESCE({table}.meta->'source_document_ids', '[]'::jsonb)
                              || COALESCE(excluded.meta->'source_document_ids', '[]'::jsonb)
                            ) AS t(e)))
             ELSE ({table}.meta || excluded.meta)
        END{confidence}
        """
    )


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
        # Merge JSONB meta (Quellen vereinigt); keep existing status/first_seen.
        set_={"meta": _merge_meta("graph_nodes")},
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
        set_={
            # greatest statt Überschreiben: eine schwächere Extraktion darf eine
            # gut belegte Kante nicht still abwerten.
            "weight": func.greatest(GraphEdge.weight, ins.excluded.weight),
            "meta": _merge_meta("graph_edges", monotonic_confidence=True),
        },
    )
    session.execute(stmt)


def graph_counts(session: Session) -> dict[str, int]:
    """Zählt in der Datenbank statt jede Zeile nach Python zu holen."""
    return {
        "nodes": session.execute(select(func.count()).select_from(GraphNode)).scalar_one(),
        "edges": session.execute(select(func.count()).select_from(GraphEdge)).scalar_one(),
    }
