"""ORM models — schema per PLAN §6.

Two data zones live in one schema (``sensitivity``). Graphs are relational
(``graph_nodes``/``graph_edges``) rather than a graph DB — PLAN §4. The raw DDL
(pgvector extension, generated ``content_tsv``, HNSW/GIN indexes) lives in the
first Alembic migration; these ORM classes mirror it for querying.
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    CheckConstraint,
    Computed,
    ForeignKey,
    Index,
    Integer,
    PrimaryKeyConstraint,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.config import get_settings
from app.db.base import Base

EMBED_DIM = get_settings().embed_dim

# Allowed enum-like values (kept in Python to validate before insert; DB enforces too).
SENSITIVITIES = ("public", "internal", "confidential")
NODE_KINDS = ("repo", "technology", "domain", "paper", "concept", "model", "dataset")
EDGE_RELATIONS = (
    "USES",
    "BUILT_WITH",
    "RELATED_TO",
    "INTRODUCES",
    "EVALUATES_ON",
    "IMPROVES_ON",
)
STATUSES = ("pending", "verified", "rejected")


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    source_type: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    uri: Mapped[str | None] = mapped_column(Text)
    content_hash: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    sensitivity: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'public'"))
    lang: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'english'"))
    meta: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'"))
    created_at: Mapped[dt.datetime] = mapped_column(server_default=text("now()"))

    chunks: Mapped[list[Chunk]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint(
            "sensitivity IN ('public','internal','confidential')",
            name="ck_documents_sensitivity",
        ),
    )


class Chunk(Base):
    __tablename__ = "chunks"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE")
    )
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    lang: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'english'"))
    # Generated column — populated by Postgres from `content`/`lang`; never written by ORM.
    content_tsv: Mapped[str | None] = mapped_column(
        TSVECTOR,
        Computed(
            "CASE WHEN lang = 'german' "
            "THEN to_tsvector('german'::regconfig, content) "
            "ELSE to_tsvector('english'::regconfig, content) END",
            persisted=True,
        ),
        nullable=True,
    )
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBED_DIM), nullable=True)
    embed_model: Mapped[str] = mapped_column(Text, nullable=False)
    meta: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'"))

    document: Mapped[Document] = relationship(back_populates="chunks")


class GraphNode(Base):
    __tablename__ = "graph_nodes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'verified'"))
    first_seen: Mapped[dt.datetime] = mapped_column(nullable=False, server_default=text("now()"))
    meta: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'"))

    __table_args__ = (
        UniqueConstraint("kind", "name", name="uq_graph_nodes_kind_name"),
        CheckConstraint(
            "kind IN ('repo','technology','domain','paper','concept','model','dataset')",
            name="ck_graph_nodes_kind",
        ),
        CheckConstraint(
            "status IN ('pending','verified','rejected')", name="ck_graph_nodes_status"
        ),
    )


class GraphEdge(Base):
    __tablename__ = "graph_edges"

    source: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("graph_nodes.id", ondelete="CASCADE")
    )
    target: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("graph_nodes.id", ondelete="CASCADE")
    )
    relation: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'verified'"))
    first_seen: Mapped[dt.datetime] = mapped_column(nullable=False, server_default=text("now()"))
    weight: Mapped[float] = mapped_column(server_default=text("1.0"))
    meta: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'"))

    __table_args__ = (
        PrimaryKeyConstraint("source", "target", "relation", name="pk_graph_edges"),
        CheckConstraint(
            "relation IN ('USES','BUILT_WITH','RELATED_TO',"
            "'INTRODUCES','EVALUATES_ON','IMPROVES_ON')",
            name="ck_graph_edges_relation",
        ),
        CheckConstraint(
            "status IN ('pending','verified','rejected')", name="ck_graph_edges_status"
        ),
        Index("idx_graph_edges_target", "target"),
    )


__all__ = [
    "Base",
    "Document",
    "Chunk",
    "GraphNode",
    "GraphEdge",
    "SENSITIVITIES",
    "NODE_KINDS",
    "EDGE_RELATIONS",
    "STATUSES",
]
