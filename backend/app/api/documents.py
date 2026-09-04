"""Documents API: list, detail with content, upload (PDF/Markdown), edit, delete.

Upload takes the raw file bytes as the request body (no multipart — keeps the
dependency set unchanged); filename via query. Ingestion reuses the Phase 3 pipeline
(idempotent via content_hash) and is admin-key gated. Markdown documents can be
edited in place (re-chunk + re-embed, hash moves — ADR-0007).

Die drei Schreibwege (Upload, Bearbeiten, Loeschen) haengen an
``require_writes_enabled`` und sind ausgeliefert abgeschaltet — in Produktion bietet
die Oberflaeche sie nicht an, offen waeren sie nur Angriffsflaeche (ADR-0024).
"""

from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.http import no_store, public_cache
from app.core.security import rate_limit, require_admin, require_writes_enabled
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


#: Voreinstellung der Seitengröße. Großzügig, weil die Oberfläche die Liste am
#: Stück zeigt — aber endlich, damit ein wachsender Korpus die Antwort nicht
#: unbemerkt aufbläht.
DEFAULT_PAGE = 200


def _cache(response: Response) -> None:
    """Lesewege zwischenspeicherbar machen — außer die Instanz darf schreiben."""
    if get_settings().writes_enabled:
        no_store(response)
    else:
        public_cache(response)


@router.get("/documents", dependencies=[Depends(rate_limit)])
def list_documents(
    response: Response,
    limit: int = Query(default=DEFAULT_PAGE, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> list[dict]:
    """Dokumente mit Chunk-Zahl, neueste zuerst. Öffentlich lesbar, gedrosselt.

    Zwischenspeicherbar wie ``/graph`` — der Bestand ändert sich mit dem
    Ingest, nicht mit dem Seitenaufruf. Ohne die Kopfzeile holte der Browser
    die Liste bei jedem Reiterwechsel neu, und jede dieser Anfragen zählte
    gegen das Rate-Limit; der Reiter „Dokumente" endete dadurch in ``429``.
    Auf einer Instanz mit offenen Schreibwegen entfällt das Caching, sonst
    stünde dort nach dem Bearbeiten der alte Stand.
    """
    _cache(response)
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
        .limit(limit)
        .offset(offset)
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


@router.get("/documents/{doc_id}", dependencies=[Depends(rate_limit)])
def get_document(doc_id: uuid.UUID, response: Response, db: Session = Depends(get_db)) -> dict:
    """Document detail incl. full content for the reader."""
    _cache(response)
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


@router.post(
    "/ingest",
    dependencies=[Depends(require_writes_enabled), Depends(rate_limit)],
)
async def ingest_upload(
    request: Request,
    filename: str = Query(min_length=1, max_length=200),
    db: Session = Depends(get_db),
) -> dict:
    """Admin-only: upload a PDF or Markdown file (raw bytes body).

    Nur erreichbar mit WRITES_ENABLED=true (ADR-0024). Bevor dieser Weg je wieder
    oeffentlich geschaltet wird, sind drei bekannte Fehler zu beheben:

    1. Der Handler ist ``async``, ruft aber synchron Docling und blockierende
       Embeddings — waehrend eines PDFs steht der Event-Loop samt laufender
       SSE-Streams. Entweder ``def`` (Threadpool) oder ``run_in_executor``.
    2. Der Body wird ohne Groessengrenze in den RAM gelesen; die Pruefung unten
       greift nur im Markdown-Zweig. Der PDF-Zweig braucht ein eigenes Limit und
       Caddy ein ``request_body max_size``.
    3. Das Ziel ist ``data/uploads/<basename>``: zwei PDFs gleichen Namens
       ueberschreiben sich auf der Platte, obwohl die DB per Hash dedupliziert.
       Hash-Praefix in den Dateinamen.
    """
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


@router.put(
    "/documents/{doc_id}/content",
    dependencies=[Depends(require_writes_enabled), Depends(rate_limit)],
)
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


@router.delete(
    "/documents/{doc_id}",
    status_code=204,
    dependencies=[Depends(require_writes_enabled)],
)
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
