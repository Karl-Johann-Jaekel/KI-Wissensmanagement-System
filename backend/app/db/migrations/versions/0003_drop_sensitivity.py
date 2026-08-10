"""drop documents.sensitivity — Korpus ist vollständig öffentlich (ADR-0015)

Revision ID: 0003_drop_sensitivity
Revises: 0002_content_md
Create Date: 2026-08-10

Die Zwei-Zonen-Architektur (public/confidential mit lokalem Modellzwang) wandert
in ein eigenes Projekt. Hier bleibt ein rein öffentlicher Forschungskorpus, für
den die Spalte keine Information mehr trägt.

Der downgrade stellt die Spalte samt CHECK wieder her; alle Bestandszeilen
landen dabei in ``public`` — die ursprüngliche Einstufung ist danach verloren.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0003_drop_sensitivity"
down_revision: str | None = "0002_content_md"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE documents DROP CONSTRAINT IF EXISTS ck_documents_sensitivity;")
    op.execute("ALTER TABLE documents DROP COLUMN IF EXISTS sensitivity;")


def downgrade() -> None:
    op.execute(
        "ALTER TABLE documents ADD COLUMN sensitivity TEXT NOT NULL DEFAULT 'public' "
        "CONSTRAINT ck_documents_sensitivity "
        "CHECK (sensitivity IN ('public','internal','confidential'));"
    )
