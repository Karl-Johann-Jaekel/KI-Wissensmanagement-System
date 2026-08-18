"""ORM models — schema per PLAN §6.

Graphs are relational
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
    ForeignKeyConstraint,
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
# "repo" und "task" tragen die Fremdquellen-Entitäten (Papers with Code, ADR-0017);
# "repo" stammt aus Phase 1 und wurde bewusst nicht gelöscht (ADR-0004).
NODE_KINDS = (
    "repo",
    "technology",
    "domain",
    "paper",
    "concept",
    "model",
    "dataset",
    "task",
)
EDGE_RELATIONS = (
    "USES",
    "BUILT_WITH",
    "RELATED_TO",
    "INTRODUCES",
    "EVALUATES_ON",
    "IMPROVES_ON",
    "IMPLEMENTS",
    "USES_DATASET",
    "ACHIEVES_SOTA",
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
    lang: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'english'"))
    # Volles Markdown fürs Frontend (Reader/Editor); NULL bei Alt-Dokumenten.
    content_md: Mapped[str | None] = mapped_column(Text)
    meta: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'"))
    created_at: Mapped[dt.datetime] = mapped_column(server_default=text("now()"))

    chunks: Mapped[list[Chunk]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
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
            "kind IN ('repo','technology','domain','paper','concept','model','dataset','task')",
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
            "'INTRODUCES','EVALUATES_ON','IMPROVES_ON',"
            "'IMPLEMENTS','USES_DATASET','ACHIEVES_SOTA')",
            name="ck_graph_edges_relation",
        ),
        CheckConstraint(
            "status IN ('pending','verified','rejected')", name="ck_graph_edges_status"
        ),
        Index("idx_graph_edges_target", "target"),
    )


# ------------------------------------------------------------------ Provenienz
# Vier Tabellen, die Herkunft aus JSONB in Zeilen holen (Migration 0005, ADR-0020).
# Warum überhaupt: In JSONB trägt eine Aussage genau eine Quelle — belegen zwei
# Quellen dieselbe Aussage, überschreibt der Upsert die eine mit der anderen.


class DocumentSource(Base):
    """Woher ein Dokument stammt. Mehrere Quellen je Dokument sind der Normalfall.

    ``document_id`` darf NULL sein: Der Harvester kennt einen Datensatz, lange bevor
    ein PDF geholt und ein Dokument angelegt ist (ADR-0018).
    """

    __tablename__ = "document_sources"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE")
    )
    source_system: Mapped[str] = mapped_column(Text, nullable=False)
    source_id: Mapped[str] = mapped_column(Text, nullable=False)
    source_url: Mapped[str | None] = mapped_column(Text)
    license: Mapped[str | None] = mapped_column(Text)
    doi: Mapped[str | None] = mapped_column(Text)
    title: Mapped[str | None] = mapped_column(Text)
    title_key: Mapped[str | None] = mapped_column(Text)
    fetched_at: Mapped[dt.datetime] = mapped_column(nullable=False, server_default=text("now()"))
    fetched_by: Mapped[str] = mapped_column(Text, nullable=False)
    meta: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'"))

    __table_args__ = (
        UniqueConstraint("source_system", "source_id", name="uq_document_sources_system_id"),
        Index("idx_document_sources_doi", "doi"),
        Index("idx_document_sources_title_key", "title_key"),
    )


class Author(Base):
    """Autor:in als eigene Zeile — ohne jedes Kontaktfeld.

    Identität gilt **je Quellsystem**, nicht global: „P. Lewis" aus arXiv mit
    „Patrick Lewis" aus OpenReview zu verschmelzen wäre genau die
    Cross-Source-Anreicherung auf Personenebene, die dieses Projekt nicht betreibt.
    Die DB erzwingt das Verbot per CHECK, nicht die Anwendung.
    """

    __tablename__ = "authors"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    source_system: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    name_key: Mapped[str] = mapped_column(Text, nullable=False)
    first_seen: Mapped[dt.datetime] = mapped_column(nullable=False, server_default=text("now()"))
    meta: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'"))

    __table_args__ = (
        UniqueConstraint("source_system", "name_key", name="uq_authors_system_key"),
        CheckConstraint("position('@' in name) = 0", name="ck_authors_no_email_in_name"),
        CheckConstraint(
            "NOT (meta ?| ARRAY['email','emails','e_mail','mail','contact','phone'])",
            name="ck_authors_no_contact_meta",
        ),
    )


class DocumentAuthor(Base):
    __tablename__ = "document_authors"

    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE")
    )
    author_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("authors.id", ondelete="CASCADE")
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))

    __table_args__ = (PrimaryKeyConstraint("document_id", "author_id"),)


class EntityExtraction(Base):
    """Ein Beleg: Diese Aussage stammt aus dieser Quelle, von diesem Extraktor.

    Eine Zeile je Beleg — dieselbe Aussage aus zwei Quellen ergibt zwei Zeilen.
    Zeigt entweder auf einen Knoten oder auf eine Kante (CHECK erzwingt das).
    """

    __tablename__ = "entities_extracted"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    node_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("graph_nodes.id", ondelete="CASCADE")
    )
    edge_source: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    edge_target: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    edge_relation: Mapped[str | None] = mapped_column(Text)
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE")
    )
    source_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("document_sources.id", ondelete="SET NULL")
    )
    extractor: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[float | None] = mapped_column()
    conflict: Mapped[bool] = mapped_column(nullable=False, server_default=text("FALSE"))
    conflict_reason: Mapped[str | None] = mapped_column(Text)
    extracted_at: Mapped[dt.datetime] = mapped_column(nullable=False, server_default=text("now()"))
    meta: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'"))

    __table_args__ = (
        ForeignKeyConstraint(
            ["edge_source", "edge_target", "edge_relation"],
            ["graph_edges.source", "graph_edges.target", "graph_edges.relation"],
            ondelete="CASCADE",
            name="fk_entities_extracted_edge",
        ),
        CheckConstraint(
            "node_id IS NOT NULL OR (edge_source IS NOT NULL AND edge_target IS NOT NULL "
            "AND edge_relation IS NOT NULL)",
            name="ck_entities_extracted_target",
        ),
        Index("idx_entities_extracted_node", "node_id"),
        Index("idx_entities_extracted_edge", "edge_source", "edge_target", "edge_relation"),
    )


__all__ = [
    "Base",
    "Document",
    "Chunk",
    "GraphNode",
    "GraphEdge",
    "DocumentSource",
    "Author",
    "DocumentAuthor",
    "EntityExtraction",
    "NODE_KINDS",
    "EDGE_RELATIONS",
    "STATUSES",
]
