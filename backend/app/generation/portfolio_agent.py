"""Recruiter portfolio agent — fixed, parametrised graph tools + README grounding.

PLAN §7 Phase 5 + §2.8: agents call only fixed functions (no LLM-generated SQL).
Hard-limited to the public zone (portfolio graph + public READMEs).
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Document, GraphEdge, GraphNode

TECH_RELATIONS = ("USES", "BUILT_WITH")


def _repo_dict(node: GraphNode) -> dict:
    meta = node.meta or {}
    return {
        "name": node.name,
        "description": meta.get("description"),
        "url": meta.get("url"),
        "stars": meta.get("stars", 0),
    }


def technologies_of(session: Session, repo_name: str) -> list[str]:
    """Technology names a repo uses/was built with."""
    repo = session.execute(
        select(GraphNode).where(GraphNode.kind == "repo", GraphNode.name == repo_name)
    ).scalar_one_or_none()
    if repo is None:
        return []
    rows = session.execute(
        select(GraphNode.name)
        .join(GraphEdge, GraphEdge.target == GraphNode.id)
        .where(
            GraphEdge.source == repo.id,
            GraphEdge.relation.in_(TECH_RELATIONS),
            GraphNode.kind == "technology",
        )
    ).all()
    return sorted({r[0] for r in rows})


def repos_by_technology(session: Session, tech_name: str) -> list[dict]:
    """Repos that use/were built with a given technology."""
    tech = session.execute(
        select(GraphNode).where(GraphNode.kind == "technology", GraphNode.name == tech_name)
    ).scalar_one_or_none()
    if tech is None:
        return []
    repos = (
        session.execute(
            select(GraphNode)
            .join(GraphEdge, GraphEdge.source == GraphNode.id)
            .where(
                GraphEdge.target == tech.id,
                GraphEdge.relation.in_(TECH_RELATIONS),
                GraphNode.kind == "repo",
            )
        )
        .scalars()
        .all()
    )
    return [_repo_dict(r) for r in repos]


def related_repos(session: Session, repo_name: str) -> list[str]:
    """Repos sharing at least one technology with the given repo."""
    techs = technologies_of(session, repo_name)
    names: set[str] = set()
    for tech in techs:
        for repo in repos_by_technology(session, tech):
            if repo["name"] != repo_name:
                names.add(repo["name"])
    return sorted(names)


def _readme_snippet(session: Session, repo_name: str, limit: int = 600) -> str | None:
    doc = session.execute(
        select(Document).where(Document.source_type == "github_readme", Document.title == repo_name)
    ).scalar_one_or_none()
    if doc is None:
        return None
    content = (doc.meta or {}).get("content")
    return content[:limit] if content else None


def _all_technology_names(session: Session) -> list[str]:
    rows = session.execute(select(GraphNode.name).where(GraphNode.kind == "technology")).all()
    return [r[0] for r in rows]


def _top_repos(session: Session, limit: int) -> list[dict]:
    repos = session.execute(select(GraphNode).where(GraphNode.kind == "repo")).scalars().all()
    return sorted((_repo_dict(r) for r in repos), key=lambda r: r["stars"], reverse=True)[:limit]


def build_portfolio_context(
    session: Session, query: str, *, max_repos: int = 6
) -> tuple[str, list[dict]]:
    """Deterministically assemble context (repos + tech + README snippets) for a query."""
    q = query.lower()
    matched = [t for t in _all_technology_names(session) if t.lower() in q]

    repos: dict[str, dict] = {}
    for tech in matched:
        for repo in repos_by_technology(session, tech):
            repos.setdefault(repo["name"], repo)
    if not repos:
        for repo in _top_repos(session, max_repos):
            repos.setdefault(repo["name"], repo)

    selected = list(repos.values())[:max_repos]
    blocks, sources = [], []
    for repo in selected:
        techs = technologies_of(session, repo["name"])
        readme = _readme_snippet(session, repo["name"])
        block = (
            f"Repo: {repo['name']}\n"
            f"URL: {repo['url']}\n"
            f"Beschreibung: {repo['description'] or '—'}\n"
            f"Tech-Stack: {', '.join(techs) or '—'}"
        )
        if readme:
            block += f"\nREADME (Auszug): {readme}"
        blocks.append(block)
        sources.append({"repo": repo["name"], "url": repo["url"]})
    return "\n\n".join(blocks), sources
