"""DB-backed tests: idempotent knowledge-graph upserts + GET /graph.

Skipped automatically when no database is reachable (see db_session fixture).
Also covers the Phase-8 contract: pending facts are hidden unless requested.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterator
from contextlib import contextmanager

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


# ------------------------------------------------- Kantenfilter + Caching (L2)


@contextmanager
def _bind(session: Session) -> Iterator[None]:
    """FastAPI braucht eine Generator-*Funktion*, kein zurueckgegebenes Generator-Objekt."""

    def _override() -> Iterator[Session]:
        yield session

    app.dependency_overrides[get_db] = _override
    try:
        yield
    finally:
        app.dependency_overrides.clear()


def test_edges_to_filtered_out_nodes_are_not_returned(
    db_session: Session, client: TestClient
) -> None:
    """Kanten werden in SQL auf die ausgewaehlte Knotenmenge eingeschraenkt.

    Vorher las der Endpunkt *alle* Kanten und warf sie in Python weg — bei 23k
    Kanten je anonymem Aufruf. Der Filter muss dieselbe Antwort liefern.
    """
    _reset_graph(db_session)
    native = upsert_node(db_session, "paper", "Native Paper")
    foreign = upsert_node(
        db_session, "paper", "Foreign Paper", {"provenance": {"source": "paperswithcode"}}
    )
    upsert_edge(db_session, native, foreign, "RELATED_TO")
    db_session.commit()

    with _bind(db_session):
        native_view = client.get("/graph", params={"source": "native"}).json()
        all_view = client.get("/graph").json()

    assert {n["name"] for n in native_view["nodes"]} == {"Native Paper"}
    # Die Kante haengt an einem Knoten, der herausgefiltert wurde -> darf nicht kommen.
    assert native_view["links"] == []
    # Ohne Filter ist sie da: der Filter schneidet, er verliert nicht.
    assert len(all_view["links"]) == 1


def test_public_graph_is_cacheable_review_view_is_not(
    db_session: Session, client: TestClient
) -> None:
    _reset_graph(db_session)
    _seed_knowledge(db_session)
    with _bind(db_session):
        public = client.get("/graph")
        review = client.get(
            "/graph",
            params={"include_pending": "true"},
            headers={"X-API-Key": get_settings().admin_api_key},
        )

    assert "max-age" in public.headers["cache-control"]
    # Ungeprüfte Fakten gehoeren in keinen geteilten Cache.
    assert review.headers["cache-control"] == "private, no-store"


# ------------------------------------- Provenienz akkumuliert (U1) / Gewicht (U2)


def test_edge_provenance_accumulates_across_documents(db_session: Session) -> None:
    """Zwei Papers, dieselbe Kante — beide Quellen müssen erhalten bleiben.

    Vorher ersetzte der flache ``||``-Merge die Liste: von zwei Belegen blieb
    einer übrig. Genau davon lebt die 2-Quellen-Regel der Promotion, weshalb im
    Bestand nur 13 von 13.271 Knoten mehrfach belegt waren.
    """
    _reset_graph(db_session)
    a = upsert_node(db_session, "paper", "Paper A")
    b = upsert_node(db_session, "concept", "Geteiltes Konzept")
    upsert_edge(db_session, a, b, "INTRODUCES", meta={"source_document_ids": ["doc-1"]})
    upsert_edge(db_session, a, b, "INTRODUCES", meta={"source_document_ids": ["doc-2"]})
    db_session.commit()

    sources = db_session.execute(
        text("SELECT meta->'source_document_ids' FROM graph_edges WHERE relation='INTRODUCES'")
    ).scalar_one()
    assert sorted(sources) == ["doc-1", "doc-2"]


def test_repeated_source_is_not_counted_twice(db_session: Session) -> None:
    """Derselbe Beleg zweimal bleibt ein Beleg — sonst wäre die Regel ausgehebelt."""
    _reset_graph(db_session)
    a = upsert_node(db_session, "paper", "Paper A")
    b = upsert_node(db_session, "concept", "Konzept")
    for _ in range(3):
        upsert_edge(db_session, a, b, "INTRODUCES", meta={"source_document_ids": ["doc-1"]})
    db_session.commit()

    sources = db_session.execute(
        text("SELECT meta->'source_document_ids' FROM graph_edges")
    ).scalar_one()
    assert sources == ["doc-1"]


def test_node_provenance_accumulates(db_session: Session) -> None:
    _reset_graph(db_session)
    upsert_node(db_session, "concept", "RAG", {"source_document_ids": ["doc-1"]})
    upsert_node(db_session, "concept", "RAG", {"source_document_ids": ["doc-2"]})
    db_session.commit()
    sources = db_session.execute(
        text("SELECT meta->'source_document_ids' FROM graph_nodes WHERE name='RAG'")
    ).scalar_one()
    assert sorted(sources) == ["doc-1", "doc-2"]


def test_meta_without_sources_is_untouched(db_session: Session) -> None:
    """Ohne den Schlüssel darf die Zusammenführung ihn nicht erfinden."""
    _reset_graph(db_session)
    upsert_node(db_session, "concept", "Ohne Beleg", {"x": 1})
    upsert_node(db_session, "concept", "Ohne Beleg", {"y": 2})
    db_session.commit()
    meta = db_session.execute(
        text("SELECT meta FROM graph_nodes WHERE name='Ohne Beleg'")
    ).scalar_one()
    assert meta == {"x": 1, "y": 2}


def test_edge_weight_and_confidence_only_grow(db_session: Session) -> None:
    """Eine spätere, schwächere Extraktion darf eine belegte Kante nicht abwerten."""
    _reset_graph(db_session)
    a = upsert_node(db_session, "paper", "Paper A")
    b = upsert_node(db_session, "concept", "Konzept")
    upsert_edge(db_session, a, b, "IMPROVES_ON", weight=0.95, meta={"confidence": 0.95})
    upsert_edge(db_session, a, b, "IMPROVES_ON", weight=0.5, meta={"confidence": 0.5})
    db_session.commit()

    weight, confidence = db_session.execute(
        text("SELECT weight, (meta->>'confidence')::float8 FROM graph_edges")
    ).one()
    assert weight == 0.95
    assert confidence == 0.95


def test_edge_confidence_can_rise(db_session: Session) -> None:
    _reset_graph(db_session)
    a = upsert_node(db_session, "paper", "Paper A")
    b = upsert_node(db_session, "concept", "Konzept")
    upsert_edge(db_session, a, b, "RELATED_TO", weight=0.4, meta={"confidence": 0.4})
    upsert_edge(db_session, a, b, "RELATED_TO", weight=0.8, meta={"confidence": 0.8})
    db_session.commit()
    weight = db_session.execute(text("SELECT weight FROM graph_edges")).scalar_one()
    assert weight == 0.8
