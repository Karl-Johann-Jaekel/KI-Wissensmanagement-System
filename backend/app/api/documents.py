"""Documents API: list, detail with content, upload (PDF/Markdown), edit, delete.

Upload takes the raw file bytes as the request body (no multipart — keeps the
dependency set unchanged); filename via query. Ingestion reuses the Phase 3 pipeline
(idempotent via content_hash) and is admin-key gated. Markdown documents can be
edited in place (re-chunk + re-embed, hash moves — ADR-0007).
"""

from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import rate_limit, require_admin
from app.db.models import Chunk, Document
from app.db.session import get_db
from app.ingestion.pipeline import (
    content_hash_bytes,
    ingest_file,
    ingest_markdown,
    reingest_document,
)

router = APIRouter(tags=["documents"])

UPLOAD_DIR = Path("data/uploads")
MAX_MARKDOWN_BYTES = 2 * 1024 * 1024  # 2 MB


@router.get("/documents")
def list_documents(request: Request, db: Session = Depends(get_db)) -> list[dict]:
    """All documents (admin) or public-only (everyone), with chunk counts."""
    stmt = (
        select(
            Document.id,
            Document.title,
            Document.source_type,
            Document.lang,
            Document.uri,
            func.count(Chunk.id).label("chunks"),
        )
        .join(Chunk, Chunk.document_id == Document.id, isouter=True)
        .group_by(Document.id)
        .order_by(Document.created_at.desc())
    )
    return [
        {
            "id": str(row.id),
            "title": row.title,
            "source_type": row.source_type,
            "lang": row.lang,
            "uri": row.uri,
            "chunks": row.chunks,
        }
        for row in db.execute(stmt)
    ]


def _get_document(db: Session, doc_id: uuid.UUID) -> Document:
    doc = db.get(Document, doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="document not found")
    return doc


def _reassembled_content(db: Session, doc_id: uuid.UUID) -> str:
    """Lossy fallback for pre-content_md documents: chunks joined in order."""
    rows = db.execute(
        select(Chunk.content, Chunk.meta)
        .where(Chunk.document_id == doc_id)
        .order_by(Chunk.chunk_index)
    ).all()
    parts: list[str] = []
    last_heading: str | None = None
    for content, meta in rows:
        heading = (meta or {}).get("heading")
        if heading and heading != last_heading:
            parts.append(f"## {heading}")
            last_heading = heading
        parts.append(content)
    return "\n\n".join(parts)


@router.get("/documents/{doc_id}")
def get_document(doc_id: uuid.UUID, db: Session = Depends(get_db)) -> dict:
    """Document detail incl. full content for the reader/editor."""
    doc = _get_document(db, doc_id)
    n_chunks = db.execute(
        select(func.count(Chunk.id)).where(Chunk.document_id == doc.id)
    ).scalar_one()
    if doc.content_md is not None:
        content, content_source = doc.content_md, "stored"
    else:
        content, content_source = _reassembled_content(db, doc.id), "reassembled"
    return {
        "id": str(doc.id),
        "title": doc.title,
        "source_type": doc.source_type,
        "lang": doc.lang,
        "uri": doc.uri,
        "meta": doc.meta,
        "created_at": doc.created_at.isoformat(),
        "chunks": n_chunks,
        "content": content,
        "content_source": content_source,
        "editable": doc.source_type == "markdown" and doc.content_md is not None,
    }


@router.post("/ingest", dependencies=[Depends(rate_limit)])
async def ingest_upload(
    request: Request,
    filename: str = Query(min_length=1, max_length=200),
    db: Session = Depends(get_db),
) -> dict:
    """Admin-only: upload a PDF or Markdown file (raw bytes body)."""
    require_admin(request)
    raw = await request.body()
    if not raw:
        raise HTTPException(status_code=400, detail="empty body")

    safe_name = Path(filename).name  # strip any path components
    content_type = request.headers.get("content-type", "")
    is_markdown = content_type.startswith("text/markdown") or safe_name.lower().endswith(".md")

    if is_markdown:
        if len(raw) > MAX_MARKDOWN_BYTES:
            raise HTTPException(status_code=413, detail="markdown too large (max 2 MB)")
        try:
            raw.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise HTTPException(status_code=400, detail="markdown must be UTF-8") from exc
        if not safe_name.lower().endswith(".md"):
            safe_name += ".md"
    else:
        if not raw[:5].startswith(b"%PDF"):
            raise HTTPException(status_code=400, detail="not a PDF or Markdown file")
        if not safe_name.lower().endswith(".pdf"):
            safe_name += ".pdf"

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    target = UPLOAD_DIR / safe_name
    target.write_bytes(raw)

    if is_markdown:
        status, n_chunks = ingest_markdown(db, target)
    else:
        status, n_chunks = ingest_file(db, target)
    return {"filename": safe_name, "status": status, "chunks": n_chunks}


class ContentUpdate(BaseModel):
    content: str = Field(min_length=1, max_length=2_000_000)


@router.put("/documents/{doc_id}/content", dependencies=[Depends(rate_limit)])
def update_document_content(
    request: Request,
    doc_id: uuid.UUID,
    body: ContentUpdate,
    db: Session = Depends(get_db),
) -> dict:
    """Admin-only: replace a Markdown document's content (re-chunk + re-embed)."""
    require_admin(request)
    doc = db.get(Document, doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="document not found")
    if doc.source_type != "markdown":
        raise HTTPException(status_code=409, detail="only markdown documents are editable")

    new_hash = content_hash_bytes(body.content.encode("utf-8"))
    duplicate = db.execute(
        select(Document.id).where(Document.content_hash == new_hash, Document.id != doc.id)
    ).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="identical content already exists")

    n_chunks = reingest_document(db, doc, body.content)

    # Datei unter data/uploads mitziehen, damit Datei und DB nicht divergieren.
    if doc.uri:
        path = Path(doc.uri)
        try:
            if path.is_file() and UPLOAD_DIR.resolve() in path.resolve().parents:
                path.write_text(body.content, encoding="utf-8")
        except OSError:
            pass  # Datei-Sync ist best-effort; DB ist die Wahrheit

    return {"id": str(doc.id), "status": "updated", "chunks": n_chunks}


@router.delete("/documents/{doc_id}", status_code=204)
def delete_document(request: Request, doc_id: uuid.UUID, db: Session = Depends(get_db)) -> Response:
    """Admin-only: delete a document (chunks cascade in the DB)."""
    require_admin(request)
    doc = db.get(Document, doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="document not found")

    uri = doc.uri
    db.delete(doc)
    db.commit()

    if uri:
        path = Path(uri)
        try:
            if path.is_file() and UPLOAD_DIR.resolve() in path.resolve().parents:
                path.unlink()
        except OSError:
            pass  # best-effort
    return Response(status_code=204)
