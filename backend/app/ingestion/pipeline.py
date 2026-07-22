"""Ingestion pipeline: PDF -> Markdown -> chunks -> embeddings -> DB.

Idempotent via ``documents.content_hash`` (hash of the raw file bytes): a second run
over the same corpus inserts nothing (PLAN §7 Phase 3 DoD). OCR and embedding are
injectable so the pipeline can be tested end-to-end with fakes (no Docling/Ollama).
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models import Chunk, Document
from app.ingestion.chunking import chunk_markdown
from app.ingestion.embedding import embed_texts
from app.ingestion.ocr import to_markdown

ToMarkdown = Callable[[Path], str]
EmbedFn = Callable[[list[str]], list[list[float]]]


@dataclass
class IngestStats:
    added: int = 0
    skipped: int = 0
    empty: int = 0
    failed: int = 0
    chunks: int = 0


def content_hash_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def document_exists(session: Session, content_hash: str) -> bool:
    return (
        session.execute(select(Document.id).where(Document.content_hash == content_hash)).first()
        is not None
    )


def _load_sidecar(pdf_path: Path) -> dict:
    sidecar = pdf_path.with_suffix(".json")
    if sidecar.exists():
        try:
            return json.loads(sidecar.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {}
    return {}


def ingest_file(
    session: Session,
    pdf_path: Path,
    sensitivity: str,
    lang: str | None = None,
    *,
    to_md: ToMarkdown = to_markdown,
    embed_fn: EmbedFn = embed_texts,
) -> tuple[str, int]:
    """Ingest one PDF. Returns (status, n_chunks); status in added|skipped|empty."""
    raw = pdf_path.read_bytes()
    content_hash = content_hash_bytes(raw)
    if document_exists(session, content_hash):
        return "skipped", 0

    sidecar = _load_sidecar(pdf_path)
    md = to_md(pdf_path)
    specs = chunk_markdown(md)
    if not specs:
        return "empty", 0

    settings = get_settings()
    vectors = embed_fn([s.content for s in specs])
    for vec in vectors:
        if len(vec) != settings.embed_dim:
            raise ValueError(
                f"embedding dim {len(vec)} != configured EMBED_DIM {settings.embed_dim} "
                f"(model {settings.embed_model})"
            )

    doc_lang = lang or sidecar.get("lang") or "english"
    doc = Document(
        source_type=sidecar.get("source_type", "pdf"),
        title=sidecar.get("title") or pdf_path.stem,
        uri=sidecar.get("uri") or str(pdf_path),
        content_hash=content_hash,
        sensitivity=sensitivity,
        lang=doc_lang,
        meta={
            k: sidecar[k]
            for k in ("id", "authors", "published", "categories", "abstract")
            if k in sidecar
        },
    )
    session.add(doc)
    session.flush()

    for spec, vec in zip(specs, vectors, strict=True):
        session.add(
            Chunk(
                document_id=doc.id,
                chunk_index=spec.index,
                content=spec.content,
                lang=doc_lang,
                embedding=vec,
                embed_model=settings.embed_model,
                meta={"heading": spec.heading},
            )
        )
    session.commit()
    return "added", len(specs)


def ingest_path(
    session: Session,
    root: Path,
    sensitivity: str,
    lang: str | None = None,
    *,
    to_md: ToMarkdown = to_markdown,
    embed_fn: EmbedFn = embed_texts,
) -> IngestStats:
    """Ingest every *.pdf under ``root`` (idempotent). Directory or single file."""
    stats = IngestStats()
    pdfs = [root] if root.is_file() else sorted(root.glob("**/*.pdf"))
    for pdf in pdfs:
        try:
            status, n = ingest_file(session, pdf, sensitivity, lang, to_md=to_md, embed_fn=embed_fn)
        except Exception as exc:  # noqa: BLE001 — one bad PDF must not abort the run
            session.rollback()
            print(f"  ! {pdf.name}: {exc}")
            stats.failed += 1
            continue
        if status == "added":
            stats.added += 1
            stats.chunks += n
            print(f"  ✓ {pdf.name}: {n} chunks")
        elif status == "skipped":
            stats.skipped += 1
        else:
            stats.empty += 1
    return stats
