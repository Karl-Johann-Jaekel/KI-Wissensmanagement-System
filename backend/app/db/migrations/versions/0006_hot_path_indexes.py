"""Indizes für die heißen Pfade: Chunk-Zugriff je Dokument, Graph-Filter, Reindex

Revision ID: 0006_hot_path_indexes
Revises: 0005_provenance
Create Date: 2026-09-01

Vier Abfragen liefen als Seq Scan, drei davon auf öffentlich erreichbaren Wegen:

* ``chunks.document_id`` — Postgres indiziert Fremdschlüssel nicht von selbst.
  Betroffen sind die Detailansicht (Reassemblierung), die Chunk-Zählung, die
  Extraktion und **jedes** ``DELETE FROM documents``: der Cascade sucht die
  Kind-Zeilen sonst je gelöschtem Dokument im Seq Scan.
* ``graph_nodes(kind, status)`` — der Filter von ``GET /graph`` und der
  Review-Liste.
* ``graph_nodes(first_seen)`` — der „Neu"-Feed unter ``/graph/changelog``.
* ``chunks.embed_model`` — ``scripts/reindex.py`` blättert über genau dieses
  Prädikat und sortiert dabei; ohne Index liest jeder Stapel die Tabelle erneut.

CONCURRENTLY, weil die Migration gegen eine laufende Instanz mit Bestand fährt:
ein gewöhnliches CREATE INDEX sperrt ``chunks`` für Schreibzugriffe. Das
verlangt Autocommit — deshalb der ``autocommit_block``. IF NOT EXISTS macht den
Lauf wiederholbar, falls ein Index von Hand angelegt wurde.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0006_hot_path_indexes"
down_revision: str | None = "0005_provenance"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_INDEXES = (
    ("idx_chunks_document_id", "chunks", "(document_id)"),
    ("idx_chunks_embed_model", "chunks", "(embed_model)"),
    ("idx_graph_nodes_kind_status", "graph_nodes", "(kind, status)"),
    ("idx_graph_nodes_first_seen", "graph_nodes", "(first_seen)"),
)


def upgrade() -> None:
    with op.get_context().autocommit_block():
        for name, table, cols in _INDEXES:
            op.execute(f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {name} ON {table} {cols}")


def downgrade() -> None:
    with op.get_context().autocommit_block():
        for name, _, _ in reversed(_INDEXES):
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {name}")
