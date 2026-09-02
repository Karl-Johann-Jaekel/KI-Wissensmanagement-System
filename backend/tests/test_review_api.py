"""Review queue API — admin gating + verify action (PLAN §7 Phase 8)."""

from __future__ import annotations

from collections.abc import Iterator

from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.graph import upsert_edge, upsert_node
from app.db.session import get_db
from app.main import app

ADMIN_KEY = get_settings().admin_api_key


def _seed_pending(session: Session) -> str:
    session.execute(text("DELETE FROM graph_nodes"))
    paper = upsert_node(session, "paper", "Some Paper", status="verified")
    concept = upsert_node(session, "concept", "Pending Concept", status="pending")
    upsert_edge(
        session,
        paper,
        concept,
        "INTRODUCES",
        meta={"source_document_ids": ["d1"], "confidence": 0.9},
        status="pending",
    )
    session.commit()
    return concept


def _override(db_session: Session):
    def _dep() -> Iterator[Session]:
        yield db_session

    return _dep


def test_review_requires_admin(client: TestClient) -> None:
    assert client.get("/review").status_code == 401


def test_review_lists_and_verifies(db_session: Session, client: TestClient) -> None:
    concept_id = _seed_pending(db_session)
    app.dependency_overrides[get_db] = _override(db_session)
    try:
        listed = client.get("/review", headers={"X-API-Key": ADMIN_KEY}).json()
        assert any(i["name"] == "Pending Concept" for i in listed["pending"])

        resp = client.post(
            f"/review/node/{concept_id}",
            params={"action": "verify"},
            headers={"X-API-Key": ADMIN_KEY},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "verified"
    finally:
        app.dependency_overrides.clear()

    status = db_session.execute(
        text("SELECT status FROM graph_nodes WHERE name='Pending Concept'")
    ).scalar_one()
    assert status == "verified"


def _seed_many_pending(session: Session, n: int = 3) -> list[str]:
    session.execute(text("DELETE FROM graph_nodes"))
    paper = upsert_node(session, "paper", "Bulk Paper", status="verified")
    ids = []
    for i in range(n):
        concept = upsert_node(session, "concept", f"Bulk Concept {i}", status="pending")
        upsert_edge(
            session,
            paper,
            concept,
            "INTRODUCES",
            meta={"source_document_ids": [f"d{i}"], "confidence": 0.8},
            status="pending",
        )
        ids.append(concept)
    session.commit()
    return ids


def test_bulk_verify_promotes_nodes_and_edges(db_session: Session, client: TestClient) -> None:
    ids = _seed_many_pending(db_session, 3)
    app.dependency_overrides[get_db] = _override(db_session)
    try:
        resp = client.post(
            "/review/bulk",
            json={"ids": ids, "action": "verify"},
            headers={"X-API-Key": ADMIN_KEY},
        )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    body = resp.json()
    assert body["processed"] == 3
    # beide Endpunkte verifiziert -> Kanten ziehen mit
    assert body["edges_verified"] == 3
    assert body["not_found"] == []

    rows = db_session.execute(
        text("SELECT status, meta FROM graph_nodes WHERE name LIKE 'Bulk Concept%'")
    ).all()
    assert {r.status for r in rows} == {"verified"}
    # Provenienz ist Pflicht (PLAN §2.7)
    assert all(r.meta.get("source_document_ids") for r in rows)


def test_bulk_reject_and_unknown_ids(db_session: Session, client: TestClient) -> None:
    import uuid

    ids = _seed_many_pending(db_session, 2)
    ghost = str(uuid.uuid4())
    app.dependency_overrides[get_db] = _override(db_session)
    try:
        resp = client.post(
            "/review/bulk",
            json={"ids": [*ids, ghost], "action": "reject"},
            headers={"X-API-Key": ADMIN_KEY},
        )
    finally:
        app.dependency_overrides.clear()

    body = resp.json()
    assert body["processed"] == 2
    assert body["not_found"] == [ghost]
    statuses = db_session.execute(
        text("SELECT status FROM graph_nodes WHERE name LIKE 'Bulk Concept%'")
    ).scalars()
    assert set(statuses) == {"rejected"}


def test_bulk_requires_admin(client: TestClient) -> None:
    resp = client.post("/review/bulk", json={"ids": [], "action": "verify"})
    assert resp.status_code == 401


def test_pending_list_is_paginated(db_session: Session, client: TestClient) -> None:
    """Ohne Grenze lieferte die Ansicht jede pending-Zeile und lud dazu *alle*
    Kanten — bei 25.000 Kanten je Aufruf, um ein paar Dutzend Zeilen zu zeigen."""
    from app.db.graph import upsert_node

    db_session.execute(text("DELETE FROM graph_nodes"))
    for i in range(7):
        upsert_node(db_session, "concept", f"Wartend {i:02d}", status="pending")
    db_session.commit()

    app.dependency_overrides[get_db] = _override(db_session)
    try:
        kopf = {"X-API-Key": ADMIN_KEY}
        erste = client.get("/review", params={"limit": 3}, headers=kopf).json()
        zweite = client.get("/review", params={"limit": 3, "offset": 3}, headers=kopf).json()
    finally:
        app.dependency_overrides.clear()

    assert len(erste["pending"]) == 3
    assert erste["count"] == 3
    assert erste["total"] == 7
    # Zweite Seite zeigt andere Knoten.
    assert {n["id"] for n in erste["pending"]}.isdisjoint({n["id"] for n in zweite["pending"]})
