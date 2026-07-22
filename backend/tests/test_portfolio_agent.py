"""DB-backed portfolio agent tools (fixed, parametrised — no LLM SQL)."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.models import Document, GraphEdge, GraphNode
from app.generation.portfolio_agent import (
    build_portfolio_context,
    repos_by_technology,
    technologies_of,
)


def _seed(session: Session) -> None:
    session.execute(text("DELETE FROM graph_nodes"))
    session.execute(text("DELETE FROM documents WHERE source_type = 'github_readme'"))
    repo = GraphNode(
        kind="repo",
        name="demo-api",
        meta={"description": "A demo API", "url": "https://github.com/x/demo-api", "stars": 5},
    )
    tech = GraphNode(kind="technology", name="FastAPI")
    session.add_all([repo, tech])
    session.flush()
    session.add(GraphEdge(source=repo.id, target=tech.id, relation="USES"))
    session.add(
        Document(
            source_type="github_readme",
            title="demo-api",
            uri="https://github.com/x/demo-api",
            content_hash="rh1",
            sensitivity="public",
            meta={"content": "This demo-api is built with FastAPI and pgvector."},
        )
    )
    session.commit()


def test_technologies_of(db_session: Session) -> None:
    _seed(db_session)
    assert technologies_of(db_session, "demo-api") == ["FastAPI"]
    assert technologies_of(db_session, "nonexistent") == []


def test_repos_by_technology(db_session: Session) -> None:
    _seed(db_session)
    repos = repos_by_technology(db_session, "FastAPI")
    assert [r["name"] for r in repos] == ["demo-api"]
    assert repos[0]["url"] == "https://github.com/x/demo-api"


def test_build_portfolio_context_matches_tech_and_readme(db_session: Session) -> None:
    _seed(db_session)
    context, sources = build_portfolio_context(db_session, "Which repos use FastAPI?")
    assert "demo-api" in context
    assert "FastAPI" in context
    assert "README" in context  # README snippet included
    assert sources == [{"repo": "demo-api", "url": "https://github.com/x/demo-api"}]
