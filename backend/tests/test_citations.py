"""Zitationsmetriken (ADR-0013): Batch-Abruf, Fehlertoleranz, Zonen-Schutz."""

from __future__ import annotations

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.corpus.citations import fetch_citation_metrics, refresh_citations
from app.db.models import Document


def _client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_batch_request_maps_arxiv_ids() -> None:
    seen: dict = {}

    def handle(request: httpx.Request) -> httpx.Response:
        import json

        seen["ids"] = json.loads(request.content)["ids"]
        return httpx.Response(
            200,
            json=[
                {"citationCount": 188137, "influentialCitationCount": 20501, "year": 2017},
                {"citationCount": 0, "influentialCitationCount": 0, "year": 2026},
            ],
        )

    metrics = fetch_citation_metrics(["1706.03762", "2607.29402"], client=_client(handle))
    assert seen["ids"] == ["arXiv:1706.03762", "arXiv:2607.29402"]
    assert metrics["1706.03762"]["citations"] == 188137
    assert metrics["1706.03762"]["influential"] == 20501
    assert metrics["2607.29402"]["citations"] == 0
    assert metrics["1706.03762"]["source"] == "semanticscholar"


def test_unknown_papers_are_skipped() -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[None, {"citationCount": 7}])

    metrics = fetch_citation_metrics(["9999.99999", "2005.11401"], client=_client(handle))
    assert "9999.99999" not in metrics
    assert metrics["2005.11401"]["citations"] == 7


def test_service_failure_is_not_fatal() -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    assert fetch_citation_metrics(["1706.03762"], client=_client(handle)) == {}


def test_empty_input_makes_no_request() -> None:
    def handle(request: httpx.Request) -> httpx.Response:  # pragma: no cover
        raise AssertionError("darf nicht aufgerufen werden")

    assert fetch_citation_metrics([], client=_client(handle)) == {}


def test_refresh_stores_metrics_on_document(db_session: Session) -> None:
    arxiv_id = "9999.00001"
    db_session.add(
        Document(
            source_type="arxiv_pdf",
            title="Cited Paper",
            content_hash="cit-doc",
            meta={"id": arxiv_id},
        )
    )
    db_session.commit()

    asked: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        import json

        ids = json.loads(request.content)["ids"]
        asked.extend(ids)
        return httpx.Response(
            200, json=[{"citationCount": 42, "influentialCitationCount": 3} for _ in ids]
        )

    refresh_citations(db_session, client=_client(handle))

    assert f"arXiv:{arxiv_id}" in asked
    doc = db_session.execute(select(Document).where(Document.title == "Cited Paper")).scalar_one()
    assert doc.meta["citations"]["citations"] == 42


def test_refresh_reads_paper_nodes_in_one_query(db_session: Session, monkeypatch) -> None:
    """Vorher lief je Dokument ein SELECT auf graph_nodes.name — ohne Index.

    Der Test zaehlt die Abfragen auf graph_nodes: mehr als eine bedeutet, dass
    das N+1 zurueck ist.
    """
    from sqlalchemy import event

    from app.corpus.citations import refresh_citations
    from app.db.graph import upsert_node
    from app.db.models import Document

    for i in range(3):
        doc = Document(
            source_type="arxiv_pdf",
            title=f"Zitationspaper {i}",
            content_hash=f"cit-n1-{i}",
            meta={"id": f"2601.0000{i}"},
        )
        db_session.add(doc)
        upsert_node(db_session, "paper", f"Zitationspaper {i}")
    db_session.commit()

    monkeypatch.setattr(
        "app.corpus.citations.fetch_citation_metrics",
        lambda ids, client=None: {i: {"citations": 5} for i in ids},
    )

    abfragen: list[str] = []

    def _zaehlen(conn, cursor, statement, params, context, executemany):  # noqa: ANN001
        if "graph_nodes" in statement and statement.lstrip().upper().startswith("SELECT"):
            abfragen.append(statement)

    event.listen(db_session.get_bind(), "before_cursor_execute", _zaehlen)
    try:
        refresh_citations(db_session)
    finally:
        event.remove(db_session.get_bind(), "before_cursor_execute", _zaehlen)

    assert len(abfragen) == 1, f"{len(abfragen)} Abfragen auf graph_nodes statt einer"
