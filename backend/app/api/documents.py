"""Documents API (PLAN §7 Phase 6): list with sensitivity, admin-only upload.

Upload takes the raw file bytes as the request body (no multipart — keeps the
dependency set unchanged); filename via query. Ingestion reuses the Phase 3 pipeline
(idempotent via content_hash) and is admin-key gated.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import is_admin, rate_limit, require_admin
from app.db.models import Chunk, Document
from app.db.session import get_db
from app.ingestion.pipeline import ingest_file

router = APIRouter(tags=["documents"])

UPLOAD_DIR = Path("data/uploads")
Sensitivity = Literal["public", "internal", "confidential"]


@router.get("/documents")
def list_documents(request: Request, db: Session = Depends(get_db)) -> list[dict]:
    """All documents (admin) or public-only (everyone), with chunk counts."""
    stmt = (
        select(
            Document.id,
            Document.title,
            Document.source_type,
            Document.sensitivity,
            Document.lang,
            Document.uri,
            func.count(Chunk.id).label("chunks"),
        )
        .join(Chunk, Chunk.document_id == Document.id, isouter=True)
        .group_by(Document.id)
        .order_by(Document.created_at.desc())
    )
    if not is_admin(request):
        stmt = stmt.where(Document.sensitivity == "public")
    return [
        {
            "id": str(row.id),
            "title": row.title,
            "source_type": row.source_type,
            "sensitivity": row.sensitivity,
            "lang": row.lang,
            "uri": row.uri,
            "chunks": row.chunks,
        }
        for row in db.execute(stmt)
    ]


@router.post("/ingest", dependencies=[Depends(rate_limit)])
async def ingest_upload(
    request: Request,
    filename: str = Query(min_length=1, max_length=200),
    sensitivity: Sensitivity = "confidential",
    db: Session = Depends(get_db),
) -> dict:
    """Admin-only: upload a PDF (raw bytes body) and ingest it into the given zone."""
    require_admin(request)
    raw = await request.body()
    if not raw:
        raise HTTPException(status_code=400, detail="empty body")
    if not raw[:5].startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="not a PDF")

    safe_name = Path(filename).name  # strip any path components
    if not safe_name.lower().endswith(".pdf"):
        safe_name += ".pdf"
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    target = UPLOAD_DIR / safe_name
    target.write_bytes(raw)

    status, n_chunks = ingest_file(db, target, sensitivity)
    return {"filename": safe_name, "status": status, "chunks": n_chunks}
