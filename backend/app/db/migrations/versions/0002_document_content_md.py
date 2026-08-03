"""documents.content_md — full markdown for reader/editor (Phase 9)

Revision ID: 0002_content_md
Revises: 0001_initial
Create Date: 2026-08-03

Stores the ingested Markdown per document (Docling output for PDFs, raw text
for Markdown uploads). Nullable: pre-existing rows fall back to lossy chunk
reassembly in the API until re-ingested.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0002_content_md"
down_revision: str | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE documents ADD COLUMN content_md TEXT;")


def downgrade() -> None:
    op.execute("ALTER TABLE documents DROP COLUMN content_md;")
