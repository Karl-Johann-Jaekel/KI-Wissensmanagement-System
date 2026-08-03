"""DB-backed ingestion test with fake OCR + embeddings (no Docling/Ollama).

Skipped when no DB reachable. Covers PLAN §7 Phase 3 DoD: idempotent ingest
(content_hash) — a second run over the same file inserts nothing.
"""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models import Chunk, Document
from app.ingestion.pipeline import ingest_file, ingest_markdown, reingest_document

FAKE_MD = "# Title\n" + "This is a sentence about retrieval. " * 60 + "\n\n## Section\nMore text."


def _fake_embed(texts: list[str]) -> list[list[float]]:
    dim = get_settings().embed_dim
    return [[0.01] * dim for _ in texts]


def _write_pdf(tmp_path: Path) -> Path:
    pdf = tmp_path / "2005.11401.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake bytes for hashing")
    (tmp_path / "2005.11401.json").write_text(
        '{"id": "2005.11401", "source_type": "arxiv_pdf", "title": "RAG", '
        '"lang": "english", "authors": ["Lewis"], "categories": ["cs.CL"]}',
        encoding="utf-8",
    )
    return pdf


def test_ingest_is_idempotent_and_stores_chunks(db_session: Session, tmp_path: Path) -> None:
    pdf = _write_pdf(tmp_path)

    status, n = ingest_file(
        db_session, pdf, "public", to_md=lambda _p: FAKE_MD, embed_fn=_fake_embed
    )
    assert status == "added"
    assert n >= 2

    doc = db_session.execute(select(Document).where(Document.title == "RAG")).scalar_one()
    assert doc.source_type == "arxiv_pdf"
    assert doc.sensitivity == "public"
    assert doc.meta["authors"] == ["Lewis"]

    chunk_count = db_session.execute(
        select(func.count()).select_from(Chunk).where(Chunk.document_id == doc.id)
    ).scalar_one()
    assert chunk_count == n

    a_chunk = db_session.execute(
        select(Chunk).where(Chunk.document_id == doc.id).limit(1)
    ).scalar_one()
    assert a_chunk.embed_model == get_settings().embed_model
    assert a_chunk.embedding is not None

    # second run over the same file -> skipped, no duplicates
    status2, n2 = ingest_file(
        db_session, pdf, "public", to_md=lambda _p: FAKE_MD, embed_fn=_fake_embed
    )
    assert status2 == "skipped"
    assert n2 == 0
    total_docs = db_session.execute(
        select(func.count()).select_from(Document).where(Document.content_hash == doc.content_hash)
    ).scalar_one()
    assert total_docs == 1


def test_ingest_stores_content_md(db_session: Session, tmp_path: Path) -> None:
    pdf = _write_pdf(tmp_path)
    ingest_file(db_session, pdf, "public", to_md=lambda _p: FAKE_MD, embed_fn=_fake_embed)
    doc = db_session.execute(select(Document).where(Document.title == "RAG")).scalar_one()
    assert doc.content_md == FAKE_MD


MD_TEXT = "# Notizen zu RAG\n\n" + "Retrieval verbessert Antworten. " * 50 + "\n\n## Fazit\nGut."


def test_ingest_markdown_roundtrip_and_idempotent(db_session: Session, tmp_path: Path) -> None:
    md = tmp_path / "notizen.md"
    md.write_text(MD_TEXT, encoding="utf-8")

    status, n = ingest_markdown(db_session, md, "confidential", embed_fn=_fake_embed)
    assert status == "added"
    assert n >= 1

    doc = db_session.execute(
        select(Document).where(Document.title == "Notizen zu RAG")
    ).scalar_one()
    assert doc.source_type == "markdown"
    assert doc.sensitivity == "confidential"
    assert doc.content_md == MD_TEXT

    status2, _ = ingest_markdown(db_session, md, "confidential", embed_fn=_fake_embed)
    assert status2 == "skipped"


def test_reingest_replaces_chunks_and_hash(db_session: Session, tmp_path: Path) -> None:
    md = tmp_path / "edit.md"
    md.write_text(MD_TEXT, encoding="utf-8")
    ingest_markdown(db_session, md, "confidential", embed_fn=_fake_embed)
    doc = db_session.execute(
        select(Document).where(Document.title == "Notizen zu RAG")
    ).scalar_one()
    old_hash = doc.content_hash
    old_chunk_ids = set(
        db_session.execute(select(Chunk.id).where(Chunk.document_id == doc.id)).scalars()
    )

    new_content = "# Notizen zu RAG\n\nKomplett neuer Inhalt über Reranking. " * 30
    n = reingest_document(db_session, doc, new_content, embed_fn=_fake_embed)
    assert n >= 1
    assert doc.content_md == new_content
    assert doc.content_hash != old_hash

    new_chunk_ids = set(
        db_session.execute(select(Chunk.id).where(Chunk.document_id == doc.id)).scalars()
    )
    assert new_chunk_ids.isdisjoint(old_chunk_ids)
    contents = (
        db_session.execute(select(Chunk.content).where(Chunk.document_id == doc.id)).scalars().all()
    )
    assert all("Reranking" in c for c in contents)
