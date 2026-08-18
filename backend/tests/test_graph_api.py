"""DB-backed tests: idempotent knowledge-graph upserts + GET /graph.

Skipped automatically when no database is reachable (see db_session fixture).
Also covers the Phase-8 contract: pending facts are hidden unless requested.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterator

from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.graph import _cap_by_kind
from app.core.config import get_settings
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
        anon_pending = client.get("/graph", params={"include_pending": "true"})
        review_view = client.get(
            "/graph",
            params={"include_pending": "true"},
            headers={"X-API-Key": get_settings().admin_api_key},
        ).json()
    finally:
        app.dependency_overrides.clear()

    default_names = {n["name"] for n in default_view["nodes"]}
    assert "Attention Is All You Need" in default_names
    assert "Fresh Pending Concept" not in default_names
    assert all(link["status"] == "verified" for link in default_view["links"])

    # pending = ungeprüfte LLM-Ausgabe -> ohne Admin-Key kein Zugriff (Phase 9 fix)
    assert anon_pending.status_code == 401

    review_names = {n["name"] for n in review_view["nodes"]}
    assert "Fresh Pending Concept" in review_names


def _cap_nodes(kind_counts: dict[str, int]) -> list:
    """Knoten-Attrappen: Papers stark vernetzt, Repos mit Grad 1 (wie im PwC-Dump)."""

    class _Node:
        def __init__(self, kind: str, name: str) -> None:
            self.id = f"{kind}-{name}"
            self.kind = kind
            self.name = name

    return [_Node(kind, f"{i:04d}") for kind, n in kind_counts.items() for i in range(n)]


def test_cap_by_kind_keeps_every_kind_represented() -> None:
    """Rein nach Grad zu kappen löschte die Code-Repos aus dem Graphen (ADR-0017)."""
    nodes = _cap_nodes({"paper": 500, "repo": 460, "task": 40})
    # Papers tragen viele Kanten, Repos genau eine — der Fall aus dem echten Import.
    val = {n.id: (9.0 if n.kind == "paper" else 1.0) for n in nodes}

    kept = _cap_by_kind(nodes, val, 200)

    assert len(kept) == 200
    by_kind = Counter(n.kind for n in kept)
    assert by_kind.keys() == {"paper", "repo", "task"}
    # Kontingente folgen dem Bestand, nicht dem Grad.
    assert by_kind["repo"] > 50
    assert by_kind["task"] >= 1


def test_cap_by_kind_prefers_the_best_connected_within_a_kind() -> None:
    nodes = _cap_nodes({"paper": 10})
    val = {n.id: float(i) for i, n in enumerate(nodes)}
    kept = _cap_by_kind(nodes, val, 3)
    assert [n.name for n in kept] == ["0009", "0008", "0007"]


def test_cap_by_kind_fills_leftover_slots_by_degree() -> None:
    """Aufgerundete Kontingente dürfen keine Plätze verschenken."""
    nodes = _cap_nodes({"paper": 7, "repo": 3})
    val = {n.id: 1.0 for n in nodes}
    assert len(_cap_by_kind(nodes, val, 5)) == 5
