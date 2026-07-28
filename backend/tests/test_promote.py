"""Promotion rules: 2-source + confidence -> verified; reciprocal IMPROVES_ON disputed."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.corpus.promote import promote_graph
from app.db.graph import upsert_edge, upsert_node


def _reset(session: Session) -> None:
    session.execute(text("DELETE FROM graph_nodes"))


def _status(session: Session, kind: str, name: str) -> str:
    return session.execute(
        text("SELECT status FROM graph_nodes WHERE kind=:k AND name=:n"), {"k": kind, "n": name}
    ).scalar_one()


def test_two_sources_promote_single_source_stays_pending(db_session: Session) -> None:
    _reset(db_session)
    p1 = upsert_node(db_session, "paper", "Paper 1", status="verified")
    p2 = upsert_node(db_session, "paper", "Paper 2", status="verified")
    two = upsert_node(db_session, "concept", "Popular Concept", status="pending")
    one = upsert_node(db_session, "concept", "Lonely Concept", status="pending")
    upsert_edge(
        db_session,
        p1,
        two,
        "INTRODUCES",
        meta={"source_document_ids": ["d1"], "confidence": 0.9},
        status="pending",
    )
    upsert_edge(
        db_session,
        p2,
        two,
        "INTRODUCES",
        meta={"source_document_ids": ["d2"], "confidence": 0.8},
        status="pending",
    )
    upsert_edge(
        db_session,
        p1,
        one,
        "INTRODUCES",
        meta={"source_document_ids": ["d1"], "confidence": 0.9},
        status="pending",
    )
    db_session.commit()

    stats = promote_graph(db_session)
    assert stats.promoted_nodes == 1
    assert _status(db_session, "concept", "Popular Concept") == "verified"
    assert _status(db_session, "concept", "Lonely Concept") == "pending"

    promoted = db_session.execute(
        text("SELECT meta FROM graph_nodes WHERE name='Popular Concept'")
    ).scalar_one()
    assert len(promoted["source_document_ids"]) == 2  # provenance recorded


def test_low_confidence_stays_pending(db_session: Session) -> None:
    _reset(db_session)
    p1 = upsert_node(db_session, "paper", "P1", status="verified")
    p2 = upsert_node(db_session, "paper", "P2", status="verified")
    c = upsert_node(db_session, "concept", "Weak Concept", status="pending")
    upsert_edge(
        db_session,
        p1,
        c,
        "INTRODUCES",
        meta={"source_document_ids": ["d1"], "confidence": 0.4},
        status="pending",
    )
    upsert_edge(
        db_session,
        p2,
        c,
        "INTRODUCES",
        meta={"source_document_ids": ["d2"], "confidence": 0.3},
        status="pending",
    )
    db_session.commit()
    promote_graph(db_session)
    assert _status(db_session, "concept", "Weak Concept") == "pending"


def test_reciprocal_improves_on_is_disputed(db_session: Session) -> None:
    _reset(db_session)
    a = upsert_node(db_session, "model", "Model A", status="verified")
    b = upsert_node(db_session, "model", "Model B", status="verified")
    upsert_edge(
        db_session,
        a,
        b,
        "IMPROVES_ON",
        meta={"source_document_ids": ["d1"], "confidence": 0.9},
        status="pending",
    )
    upsert_edge(
        db_session,
        b,
        a,
        "IMPROVES_ON",
        meta={"source_document_ids": ["d2"], "confidence": 0.9},
        status="pending",
    )
    db_session.commit()

    stats = promote_graph(db_session)
    assert stats.disputed == 2
    disputed = db_session.execute(
        text("SELECT count(*) FROM graph_edges WHERE relation='IMPROVES_ON' AND status='pending'")
    ).scalar_one()
    assert disputed == 2  # both left pending, flagged
    flagged = db_session.execute(
        text("SELECT meta->>'disputed' FROM graph_edges LIMIT 1")
    ).scalar_one()
    assert flagged == "true"
