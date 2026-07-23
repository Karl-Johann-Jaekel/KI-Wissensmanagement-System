"""DB-backed tests: idempotent knowledge-graph upserts + GET /graph.

Skipped automatically when no database is reachable (see db_session fixture).
Also covers the Phase-8 contract: pending facts are hidden unless requested.
"""

from __future__ import annotations

from collections.abc import Iterator

from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.graph import graph_counts, upsert_edge, upsert_node
from app.db.session import get_db
from app.main import app


def _reset_graph(session: Session) -> None:
    """Clean slate inside the test transaction (rolled back afterwards)."""
    session.execute(text("DELETE FROM graph_nodes"))


def _seed_knowledge(session: Session) -> None:
    paper = upsert_node(session, "paper", "Attention Is All You Need", {"arxiv": "1706.03762"})
    concept = upsert_node(session, "concept", "Self-Attention")
    pending = upsert_node(session, "concept", "Fresh Pending Concept", status="pending")
    upsert_edge(session, paper, concept, "INTRODUCES", meta={"source_document_ids": ["d1"]})
    upsert_edge(session, paper, pending, "INTRODUCES", status="pending")
    session.commit()


def test_upserts_are_idempotent(db_session: Session) -> None:
    _reset_graph(db_session)
    _seed_knowledge(db_session)
    first = graph_counts(db_session)
    _seed_knowledge(db_session)  # second run must add nothing
    assert graph_counts(db_session) == first
    assert first == {"nodes": 3, "edges": 2}


def test_upsert_preserves_existing_status(db_session: Session) -> None:
    _reset_graph(db_session)
    node_id = upsert_node(db_session, "concept", "RAG", status="pending")
    # re-upsert with default (verified) must NOT silently promote the pending node
    same_id = upsert_node(db_session, "concept", "RAG")
    assert node_id == same_id
    status = db_session.execute(
        text("SELECT status FROM graph_nodes WHERE kind='concept' AND name='RAG'")
    ).scalar_one()
    assert status == "pending"


def test_graph_endpoint_hides_pending_by_default(db_session: Session, client: TestClient) -> None:
    _reset_graph(db_session)
    _seed_knowledge(db_session)

    def _override() -> Iterator[Session]:
        yield db_session

    app.dependency_overrides[get_db] = _override
    try:
        default_view = client.get("/graph").json()
        review_view = client.get("/graph", params={"include_pending": "true"}).json()
    finally:
        app.dependency_overrides.clear()

    default_names = {n["name"] for n in default_view["nodes"]}
    assert "Attention Is All You Need" in default_names
    assert "Fresh Pending Concept" not in default_names
    assert all(link["status"] == "verified" for link in default_view["links"])

    review_names = {n["name"] for n in review_view["nodes"]}
    assert "Fresh Pending Concept" in review_names
