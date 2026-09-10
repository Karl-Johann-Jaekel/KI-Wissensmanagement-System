"""GET /stats — zählt genau das, was die öffentliche Sicht zeigt.

Der Wert des Endpunkts liegt nicht darin, *irgendeine* Zahl zu liefern, sondern
dieselbe, die ein Besucher im Graphen nachzählen könnte. Deshalb prüfen die
Tests vor allem die Abgrenzung: ungeprüfte Knoten und Kanten an ungeprüfte
Knoten bleiben draußen.

Übersprungen ohne erreichbare Datenbank (siehe ``db_session``).
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.graph import DEFAULT_NODE_LIMIT
from app.db.graph import upsert_edge, upsert_node
from app.db.session import get_db
from app.main import app


@contextmanager
def _client_on(session: Session) -> Iterator[TestClient]:
    """TestClient, der in der Transaktion des Tests liest."""
    app.dependency_overrides[get_db] = lambda: session
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def _seed(session: Session) -> None:
    session.execute(text("DELETE FROM graph_nodes"))
    paper = upsert_node(session, "paper", "Attention Is All You Need")
    concept = upsert_node(session, "concept", "Self-Attention")
    pending = upsert_node(session, "concept", "Ungeprüftes Konzept", status="pending")
    upsert_edge(session, paper, concept, "INTRODUCES")
    upsert_edge(session, paper, pending, "INTRODUCES", status="pending")
    session.commit()


def test_stats_counts_only_the_public_view(db_session: Session) -> None:
    _seed(db_session)
    with _client_on(db_session) as client:
        body = client.get("/stats").json()

    # Zwei bestätigte Knoten, der pending bleibt draußen — genau wie in /graph.
    assert body["nodes"] == 2
    assert body["edges"] == 1
    assert body["node_limit"] == DEFAULT_NODE_LIMIT


def test_stats_matches_the_delivered_graph(db_session: Session) -> None:
    """Die genannte Zahl muss die des Graphen sein, sonst ist sie wertlos."""
    _seed(db_session)
    with _client_on(db_session) as client:
        stats = client.get("/stats").json()
        graph = client.get("/graph").json()

    assert stats["nodes"] == len(graph["nodes"])
    assert stats["edges"] == len(graph["links"])


def test_stats_reports_corpus_size(db_session: Session) -> None:
    with _client_on(db_session) as client:
        body = client.get("/stats").json()

    for key in ("documents", "chunks"):
        assert isinstance(body[key], int)
        assert body[key] >= 0


def test_stats_is_publicly_cacheable(db_session: Session) -> None:
    """Ohne Cache-Kopfzeile holt jede Seitennavigation die Zahlen neu (siehe /graph)."""
    with _client_on(db_session) as client:
        res = client.get("/stats")

    assert res.status_code == 200
    assert "max-age" in res.headers["Cache-Control"]
