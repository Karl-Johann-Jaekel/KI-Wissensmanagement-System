"""Die Indizes der heißen Pfade müssen da sein (Migration 0006).

Ohne sie laufen Chunk-Zugriff je Dokument, die Graph-Filter und der „Neu"-Feed
als Seq Scan — gemessen 7,2 ms statt 0,2 ms bzw. 8,1 ms statt 0,05 ms. Der Test
hält fest, dass eine spätere Migration sie nicht stillschweigend wieder entfernt.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

EXPECTED = {
    "idx_chunks_document_id": "chunks",
    "idx_chunks_embed_model": "chunks",
    "idx_graph_nodes_kind_status": "graph_nodes",
    "idx_graph_nodes_first_seen": "graph_nodes",
}


@pytest.mark.parametrize(("index", "table"), sorted(EXPECTED.items()))
def test_hot_path_index_exists(db_session: Session, index: str, table: str) -> None:
    found = db_session.execute(
        text("SELECT tablename FROM pg_indexes WHERE indexname = :name"),
        {"name": index},
    ).scalar_one_or_none()
    assert found == table, f"Index {index} auf {table} fehlt — Migration 0006 gelaufen?"


def test_document_chunks_use_the_index(db_session: Session) -> None:
    """Der Cascade beim Löschen eines Dokuments hing an genau dieser Abfrage."""
    plan = db_session.execute(
        text(
            "EXPLAIN SELECT count(*) FROM chunks "
            "WHERE document_id = '00000000-0000-0000-0000-000000000000'"
        )
    ).scalars()
    assert "idx_chunks_document_id" in "\n".join(plan)
