"""Documents API + admin gating (PLAN §7 Phase 6; Detail/Edit/Delete Phase 9)."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models import Chunk, Document
from app.db.session import get_db
from app.main import app

ADMIN_KEY = get_settings().admin_api_key


def _seed_docs(session: Session) -> None:
    session.add_all(
        [
            Document(
                source_type="pdf",
                title="Public Phase6 Doc",
                content_hash="p6-pub",
                sensitivity="public",
            ),
            Document(
                source_type="pdf",
                title="Secret Phase6 Doc",
                content_hash="p6-conf",
                sensitivity="confidential",
            ),
        ]
    )
    session.commit()


@contextmanager
def _bind_db(session: Session) -> Iterator[None]:
    def _override() -> Iterator[Session]:
        yield session

    app.dependency_overrides[get_db] = _override
    try:
        yield
    finally:
        app.dependency_overrides.clear()


def test_documents_public_hides_confidential(db_session: Session, client: TestClient) -> None:
    _seed_docs(db_session)

    def _override() -> Iterator[Session]:
        yield db_session

    app.dependency_overrides[get_db] = _override
    try:
        public_view = client.get("/documents").json()
        admin_view = client.get("/documents", headers={"X-API-Key": ADMIN_KEY}).json()
    finally:
        app.dependency_overrides.clear()

    public_titles = {d["title"] for d in public_view}
    admin_titles = {d["title"] for d in admin_view}
    assert "Public Phase6 Doc" in public_titles
    assert "Secret Phase6 Doc" not in public_titles
    assert not any(d["sensitivity"] == "confidential" for d in public_view)
    assert "Secret Phase6 Doc" in admin_titles


def test_search_confidential_requires_admin(client: TestClient) -> None:
    resp = client.post("/search", json={"query": "x", "max_sensitivity": "confidential"})
    assert resp.status_code == 403


def test_chat_confidential_requires_admin(client: TestClient) -> None:
    resp = client.post("/chat", json={"query": "x", "max_sensitivity": "confidential"})
    assert resp.status_code == 403


def test_ingest_requires_admin_key(client: TestClient) -> None:
    resp = client.post("/ingest?filename=a.pdf", content=b"%PDF-1.4 fake")
    assert resp.status_code == 401


def test_ingest_rejects_non_pdf(client: TestClient) -> None:
    resp = client.post(
        "/ingest?filename=a.pdf", content=b"not a pdf", headers={"X-API-Key": ADMIN_KEY}
    )
    assert resp.status_code == 400


def test_ingest_markdown_rejects_bad_utf8(client: TestClient) -> None:
    resp = client.post(
        "/ingest?filename=a.md",
        content=b"\xff\xfe kaputt",
        headers={"X-API-Key": ADMIN_KEY, "Content-Type": "text/markdown"},
    )
    assert resp.status_code == 400


def test_ingest_markdown_rejects_oversize(client: TestClient) -> None:
    resp = client.post(
        "/ingest?filename=big.md",
        content=b"x" * (2 * 1024 * 1024 + 1),
        headers={"X-API-Key": ADMIN_KEY, "Content-Type": "text/markdown"},
    )
    assert resp.status_code == 413


# --------------------------------------------------------------- detail (Phase 9)


def _seed_md_doc(session: Session, *, sensitivity: str = "public") -> Document:
    doc = Document(
        source_type="markdown",
        title="MD Doc",
        content_hash=f"md-{sensitivity}",
        sensitivity=sensitivity,
        content_md="# MD Doc\n\nInhalt.",
    )
    session.add(doc)
    session.commit()
    return doc


def test_document_detail_stored_content(db_session: Session, client: TestClient) -> None:
    doc = _seed_md_doc(db_session)
    with _bind_db(db_session):
        data = client.get(f"/documents/{doc.id}").json()
    assert data["content"] == "# MD Doc\n\nInhalt."
    assert data["content_source"] == "stored"
    assert data["editable"] is True


def test_document_detail_reassembles_legacy_chunks(db_session: Session, client: TestClient) -> None:
    doc = Document(source_type="pdf", title="Legacy", content_hash="legacy-1", sensitivity="public")
    db_session.add(doc)
    db_session.flush()
    db_session.add_all(
        [
            Chunk(
                document_id=doc.id,
                chunk_index=0,
                content="Erster Teil.",
                embed_model="fake",
                meta={"heading": "Intro"},
            ),
            Chunk(
                document_id=doc.id,
                chunk_index=1,
                content="Zweiter Teil.",
                embed_model="fake",
                meta={"heading": "Fazit"},
            ),
        ]
    )
    db_session.commit()
    with _bind_db(db_session):
        data = client.get(f"/documents/{doc.id}").json()
    assert data["content_source"] == "reassembled"
    assert data["editable"] is False
    assert "## Intro" in data["content"]
    assert data["content"].index("Erster Teil.") < data["content"].index("Zweiter Teil.")


def test_document_detail_hides_confidential_as_404(db_session: Session, client: TestClient) -> None:
    doc = _seed_md_doc(db_session, sensitivity="confidential")
    with _bind_db(db_session):
        anon = client.get(f"/documents/{doc.id}")
        admin = client.get(f"/documents/{doc.id}", headers={"X-API-Key": ADMIN_KEY})
    assert anon.status_code == 404
    assert admin.status_code == 200


# ----------------------------------------------------------- edit + delete (Phase 9)


def _fake_embed(texts: list[str]) -> list[list[float]]:
    dim = get_settings().embed_dim
    return [[0.02] * dim for _ in texts]


def test_update_content_requires_admin(db_session: Session, client: TestClient) -> None:
    doc = _seed_md_doc(db_session)
    with _bind_db(db_session):
        resp = client.put(f"/documents/{doc.id}/content", json={"content": "# Neu"})
    assert resp.status_code == 401


def test_update_content_rejects_pdf_docs(db_session: Session, client: TestClient) -> None:
    _seed_docs(db_session)
    doc = db_session.execute(
        select(Document).where(Document.title == "Public Phase6 Doc")
    ).scalar_one()
    with _bind_db(db_session):
        resp = client.put(
            f"/documents/{doc.id}/content",
            json={"content": "# Neu"},
            headers={"X-API-Key": ADMIN_KEY},
        )
    assert resp.status_code == 409


def test_update_content_reingests(db_session: Session, client: TestClient, monkeypatch) -> None:
    import app.api.documents as documents_api
    from app.ingestion.pipeline import reingest_document

    monkeypatch.setattr(
        documents_api,
        "reingest_document",
        lambda session, doc, content: reingest_document(
            session, doc, content, embed_fn=_fake_embed
        ),
    )
    doc = _seed_md_doc(db_session)
    with _bind_db(db_session):
        resp = client.put(
            f"/documents/{doc.id}/content",
            json={"content": "# MD Doc\n\nGanz neuer Text über Reranking."},
            headers={"X-API-Key": ADMIN_KEY},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "updated"
    assert body["chunks"] >= 1
    db_session.refresh(doc)
    assert "Reranking" in (doc.content_md or "")


def test_update_content_conflicts_on_duplicate_hash(
    db_session: Session, client: TestClient
) -> None:
    import hashlib

    other_content = "# Anderes Dokument"
    other_hash = hashlib.sha256(other_content.encode()).hexdigest()
    db_session.add(
        Document(
            source_type="markdown",
            title="Other",
            content_hash=other_hash,
            sensitivity="public",
            content_md=other_content,
        )
    )
    doc = _seed_md_doc(db_session)
    with _bind_db(db_session):
        resp = client.put(
            f"/documents/{doc.id}/content",
            json={"content": other_content},
            headers={"X-API-Key": ADMIN_KEY},
        )
    assert resp.status_code == 409


def test_delete_document_cascades(db_session: Session, client: TestClient) -> None:
    doc = _seed_md_doc(db_session)
    db_session.add(Chunk(document_id=doc.id, chunk_index=0, content="c", embed_model="fake"))
    db_session.commit()
    doc_id = doc.id
    with _bind_db(db_session):
        anon = client.delete(f"/documents/{doc_id}")
        assert anon.status_code == 401
        resp = client.delete(f"/documents/{doc_id}", headers={"X-API-Key": ADMIN_KEY})
    assert resp.status_code == 204
    assert db_session.get(Document, doc_id) is None
    remaining = db_session.execute(select(Chunk).where(Chunk.document_id == doc_id)).first()
    assert remaining is None
