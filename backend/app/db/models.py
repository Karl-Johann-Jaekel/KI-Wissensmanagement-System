"""ORM models.

Empty in Phase 0 — the schema (documents, chunks, graph_nodes, graph_edges;
PLAN §6) lands in Phase 1 as the first Alembic migration. Import Base so that
`app.db.models` is the single module Alembic imports to populate metadata.
"""

from __future__ import annotations

from app.db.base import Base

__all__ = ["Base"]
