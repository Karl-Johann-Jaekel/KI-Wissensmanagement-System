"""Rule-based extraction: GitHub repo data -> graph nodes/edges + README documents.

Deterministic (PLAN §7 Phase 1): manifests/topics map to nodes/edges by fixed rules,
so everything is inserted with status ``verified`` (no LLM, no ``pending``). Idempotent
via UNIQUE(kind,name) / PK(source,target,relation) upserts — a second run adds nothing.
"""

from __future__ import annotations

import hashlib
import json
import re
import tomllib
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.db.models import Document, GraphEdge, GraphNode
from app.github.sync import RepoData

# --- Dependency -> canonical technology name -------------------------------------
# Only well-known direct dependencies are normalised to a canonical display name;
# unknown ones keep their raw (lowercased) name. Curbs entity wildwuchs (PLAN §11).
TECH_ALIASES: dict[str, str] = {
    # JS / TS
    "react": "React",
    "react-dom": "React",
    "next": "Next.js",
    "vue": "Vue",
    "svelte": "Svelte",
    "express": "Express",
    "vite": "Vite",
    "typescript": "TypeScript",
    "tailwindcss": "Tailwind CSS",
    "d3": "D3",
    "react-force-graph": "react-force-graph",
    "axios": "axios",
    "jest": "Jest",
    "eslint": "ESLint",
    # Python
    "fastapi": "FastAPI",
    "flask": "Flask",
    "django": "Django",
    "sqlalchemy": "SQLAlchemy",
    "alembic": "Alembic",
    "pydantic": "Pydantic",
    "pydantic-settings": "Pydantic",
    "uvicorn": "Uvicorn",
    "httpx": "httpx",
    "requests": "requests",
    "numpy": "NumPy",
    "pandas": "pandas",
    "scikit-learn": "scikit-learn",
    "torch": "PyTorch",
    "pytorch": "PyTorch",
    "tensorflow": "TensorFlow",
    "transformers": "Transformers",
    "langchain": "LangChain",
    "pgvector": "pgvector",
    "psycopg": "psycopg",
    "psycopg2": "psycopg",
    "psycopg2-binary": "psycopg",
    "pytest": "pytest",
    "ruff": "Ruff",
    "mypy": "mypy",
    "docling": "Docling",
    "fastmcp": "fastmcp",
    "ollama": "Ollama",
}

# Requirement/version noise to strip: extras, markers, specifiers.
_NAME_RE = re.compile(r"^\s*([A-Za-z0-9][A-Za-z0-9._-]*)")


def canonical_tech(raw: str) -> str:
    key = raw.strip().lower()
    return TECH_ALIASES.get(key, key)


def _dep_name(requirement: str) -> str | None:
    line = requirement.split(";", 1)[0].split("#", 1)[0].strip()
    if not line or line.startswith("-"):  # skip pip flags like -r, -e
        return None
    m = _NAME_RE.match(line)
    return m.group(1) if m else None


def parse_package_json(text: str) -> set[str]:
    try:
        data = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return set()
    deps: set[str] = set()
    for key in ("dependencies", "devDependencies", "peerDependencies"):
        section = data.get(key)
        if isinstance(section, dict):
            deps.update(section.keys())
    return deps


def parse_pyproject(text: str) -> set[str]:
    try:
        data = tomllib.loads(text)
    except (tomllib.TOMLDecodeError, ValueError):
        return set()
    deps: set[str] = set()
    project = data.get("project", {})
    for req in project.get("dependencies", []) or []:
        if name := _dep_name(req):
            deps.add(name)
    for group in (project.get("optional-dependencies", {}) or {}).values():
        for req in group or []:
            if name := _dep_name(req):
                deps.add(name)
    # Poetry
    poetry = data.get("tool", {}).get("poetry", {})
    for name in poetry.get("dependencies", {}) or {}:
        if name.lower() != "python":
            deps.add(name)
    return deps


def parse_requirements(text: str) -> set[str]:
    deps: set[str] = set()
    for line in text.splitlines():
        if name := _dep_name(line):
            deps.add(name)
    return deps


def extract_dependencies(manifests: dict[str, str]) -> set[str]:
    """Canonical technology names from a repo's manifests (direct deps only)."""
    raw: set[str] = set()
    if "package.json" in manifests:
        raw |= parse_package_json(manifests["package.json"])
    if "pyproject.toml" in manifests:
        raw |= parse_pyproject(manifests["pyproject.toml"])
    if "requirements.txt" in manifests:
        raw |= parse_requirements(manifests["requirements.txt"])
    return {canonical_tech(d) for d in raw if d}


# --- Persistence (idempotent upserts) --------------------------------------------


def upsert_node(session: Session, kind: str, name: str, meta: dict | None = None) -> str:
    ins = pg_insert(GraphNode).values(kind=kind, name=name, status="verified", meta=meta or {})
    stmt = ins.on_conflict_do_update(
        index_elements=["kind", "name"],
        # Merge JSONB meta (accumulate provenance); keep existing status/first_seen.
        set_={"meta": GraphNode.meta.op("||")(ins.excluded.meta)},
    ).returning(GraphNode.id)
    return str(session.execute(stmt).scalar_one())


def upsert_edge(
    session: Session,
    source: str,
    target: str,
    relation: str,
    weight: float = 1.0,
    meta: dict | None = None,
) -> None:
    ins = pg_insert(GraphEdge).values(
        source=source,
        target=target,
        relation=relation,
        status="verified",
        weight=weight,
        meta=meta or {},
    )
    stmt = ins.on_conflict_do_update(
        index_elements=["source", "target", "relation"],
        set_={"weight": ins.excluded.weight, "meta": ins.excluded.meta},
    )
    session.execute(stmt)


def _upsert_readme(session: Session, repo: RepoData) -> None:
    if not repo.readme:
        return
    content_hash = hashlib.sha256(repo.readme.encode("utf-8")).hexdigest()
    stmt = (
        pg_insert(Document)
        .values(
            source_type="github_readme",
            title=repo.name,
            uri=repo.html_url,
            content_hash=content_hash,
            sensitivity="public",
            lang="english",
            meta={"repo": repo.full_name, "content": repo.readme},
        )
        .on_conflict_do_nothing(index_elements=["content_hash"])
    )
    session.execute(stmt)


@dataclass
class StoreStats:
    repos: int = 0
    nodes: int = 0
    edges: int = 0


def store_portfolio(session: Session, repos: list[RepoData]) -> StoreStats:
    """Map repos -> graph + README docs and persist. Returns counts of touched items."""
    stats = StoreStats()
    for repo in repos:
        repo_id = upsert_node(
            session,
            "repo",
            repo.name,
            meta={
                "full_name": repo.full_name,
                "description": repo.description,
                "url": repo.html_url,
                "stars": repo.stars,
                "archived": repo.archived,
            },
        )
        stats.repos += 1
        stats.nodes += 1

        # Languages -> technology, BUILT_WITH, weight = byte share.
        total_bytes = sum(repo.languages.values()) or 1
        for lang, byte_count in repo.languages.items():
            tech_id = upsert_node(session, "technology", canonical_tech(lang))
            upsert_edge(
                session,
                repo_id,
                tech_id,
                "BUILT_WITH",
                weight=round(byte_count / total_bytes, 4),
                meta={"source_repo": repo.name, "bytes": byte_count},
            )
            stats.nodes += 1
            stats.edges += 1

        # Dependencies -> technology, USES.
        for tech in extract_dependencies(repo.manifests):
            tech_id = upsert_node(session, "technology", tech)
            upsert_edge(
                session,
                repo_id,
                tech_id,
                "USES",
                meta={"source_repo": repo.name, "from": "manifest"},
            )
            stats.nodes += 1
            stats.edges += 1

        # Topics -> domain, RELATED_TO.
        for topic in repo.topics:
            domain_id = upsert_node(session, "domain", topic)
            upsert_edge(session, repo_id, domain_id, "RELATED_TO", meta={"source_repo": repo.name})
            stats.nodes += 1
            stats.edges += 1

        _upsert_readme(session, repo)

    session.commit()
    return stats


def graph_counts(session: Session) -> dict[str, int]:
    nodes = session.execute(select(GraphNode.id)).all()
    edges = session.execute(select(GraphEdge.source)).all()
    return {"nodes": len(nodes), "edges": len(edges)}
