"""Graph um Fremdquellen-Arten erweitern: kind 'task', Kanten IMPLEMENTS/USES_DATASET/ACHIEVES_SOTA

Revision ID: 0004_pwc_graph_kinds
Revises: 0003_drop_sensitivity
Create Date: 2026-08-18

Der Papers-with-Code-Dump (CC-BY-SA, ADR-0017) bringt Entitäten mit, die das
Phase-8-Schema nicht kennt: Aufgaben (``task``) und die Kanten Repo→Paper
(``IMPLEMENTS``), Paper→Dataset (``USES_DATASET``) sowie Modell→Dataset
(``ACHIEVES_SOTA``). Die Knotenart ``repo`` existiert seit Phase 1 und wird für
Code-Repositories wiederverwendet statt neu erfunden (ADR-0004 ließ das Schema
absichtlich stehen).

Die CHECKs werden ersetzt, nicht gelockert — ein freies TEXT-Feld würde Tippfehler
still durchlassen und den Graphen fragmentieren.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0004_pwc_graph_kinds"
down_revision: str | None = "0003_drop_sensitivity"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

KINDS_NEW = "('repo','technology','domain','paper','concept','model','dataset','task')"
KINDS_OLD = "('repo','technology','domain','paper','concept','model','dataset')"
RELATIONS_NEW = (
    "('USES','BUILT_WITH','RELATED_TO','INTRODUCES','EVALUATES_ON','IMPROVES_ON',"
    "'IMPLEMENTS','USES_DATASET','ACHIEVES_SOTA')"
)
RELATIONS_OLD = "('USES','BUILT_WITH','RELATED_TO','INTRODUCES','EVALUATES_ON','IMPROVES_ON')"


def upgrade() -> None:
    # Migration 0001 schrieb die CHECKs als rohes DDL ohne Namen — Postgres nannte sie
    # graph_nodes_kind_check / graph_edges_relation_check. Beide Namen müssen weg,
    # sonst bleibt der alte, engere CHECK still daneben stehen und lehnt 'task' ab.
    op.execute("ALTER TABLE graph_nodes DROP CONSTRAINT IF EXISTS graph_nodes_kind_check;")
    op.execute("ALTER TABLE graph_nodes DROP CONSTRAINT IF EXISTS ck_graph_nodes_kind;")
    op.execute(
        f"ALTER TABLE graph_nodes ADD CONSTRAINT ck_graph_nodes_kind CHECK (kind IN {KINDS_NEW});"
    )
    op.execute("ALTER TABLE graph_edges DROP CONSTRAINT IF EXISTS graph_edges_relation_check;")
    op.execute("ALTER TABLE graph_edges DROP CONSTRAINT IF EXISTS ck_graph_edges_relation;")
    op.execute(
        "ALTER TABLE graph_edges ADD CONSTRAINT ck_graph_edges_relation "
        f"CHECK (relation IN {RELATIONS_NEW});"
    )
    # Quellenfilter für /graph: ohne Index scannt jede Abfrage alle Knoten.
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_graph_nodes_source "
        "ON graph_nodes ((meta -> 'provenance' ->> 'source'));"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_graph_nodes_source;")
    # Zeilen der neuen Arten müssen weg, sonst scheitert der engere CHECK.
    op.execute("DELETE FROM graph_nodes WHERE kind = 'task';")
    op.execute(
        "DELETE FROM graph_edges WHERE relation IN ('IMPLEMENTS','USES_DATASET','ACHIEVES_SOTA');"
    )
    op.execute("ALTER TABLE graph_nodes DROP CONSTRAINT IF EXISTS ck_graph_nodes_kind;")
    op.execute(
        f"ALTER TABLE graph_nodes ADD CONSTRAINT ck_graph_nodes_kind CHECK (kind IN {KINDS_OLD});"
    )
    op.execute("ALTER TABLE graph_edges DROP CONSTRAINT IF EXISTS ck_graph_edges_relation;")
    op.execute(
        "ALTER TABLE graph_edges ADD CONSTRAINT ck_graph_edges_relation "
        f"CHECK (relation IN {RELATIONS_OLD});"
    )
