"""DB-backed tests: idempotent portfolio store + GET /graph.

Skipped automatically when no database is reachable (see db_session fixture).
Covers PLAN §7 Phase 1 DoD: "Sync füllt Graph reproduzierbar".
"""

from __future__ import annotations

from collections.abc import Iterator

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.github.extract import graph_counts, store_portfolio
from app.github.sync import RepoData
from app.main import app


def _repos() -> list[RepoData]:
    return [
        RepoData(
            name="demo",
            full_name="octo/demo",
            description="d",
            html_url="https://github.com/octo/demo",
            topics=["rag"],
            languages={"Python": 800, "TypeScript": 200},
            manifests={
                "pyproject.toml": (
                    '[project]\ndependencies = ["fastapi>=0.115", "sqlalchemy>=2.0"]\n'
                )
            },
            readme="# demo readme",
        )
    ]


def test_store_portfolio_is_idempotent(db_session: Session) -> None:
    store_portfolio(db_session, _repos())
    first = graph_counts(db_session)
    store_portfolio(db_session, _repos())  # second run must add nothing
    second = graph_counts(db_session)
    assert first == second
    # 1 repo + 2 langs + 2 deps + 1 domain = 6 nodes
    assert first["nodes"] == 6


def test_graph_endpoint_returns_nodes_and_links(db_session: Session, client: TestClient) -> None:
    store_portfolio(db_session, _repos())

    def _override() -> Iterator[Session]:
        yield db_session

    app.dependency_overrides[get_db] = _override
    try:
        portfolio = client.get("/graph", params={"scope": "portfolio"}).json()
        knowledge = client.get("/graph", params={"scope": "knowledge"}).json()
    finally:
        app.dependency_overrides.clear()

    kinds = {n["kind"] for n in portfolio["nodes"]}
    assert {"repo", "technology", "domain"} <= kinds
    relations = {link["relation"] for link in portfolio["links"]}
    assert {"BUILT_WITH", "USES", "RELATED_TO"} <= relations

    # BUILT_WITH weight is the language byte share.
    built_with = [link for link in portfolio["links"] if link["relation"] == "BUILT_WITH"]
    assert any(abs(link["weight"] - 0.8) < 1e-6 for link in built_with)

    # knowledge scope is empty in Phase 1
    assert knowledge["nodes"] == []
