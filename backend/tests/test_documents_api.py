"""Documents API + admin gating (PLAN §7 Phase 6; Detail/Edit/Delete Phase 9)."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models import Chunk, Document
from app.db.session import get_db
from app.main import app

ADMIN_KEY = get_settings().admin_api_key


@pytest.fixture(autouse=True)
def _enable_writes(monkeypatch: pytest.MonkeyPatch) -> None:
    """Schreibrouten sind ausgeliefert aus (ADR-0024).

    Die Tests unten pruefen deren Verhalten, brauchen sie also an. Dass sie ohne
    das Flag verschwinden, prueft ``test_write_routes_are_gone_when_disabled``.
    """
    monkeypatch.setattr(get_settings(), "writes_enabled", True, raising=False)


def _seed_docs(session: Session) -> None:
    session.add_all(
        [
            Document(source_type="pdf", title="Public Phase6 Doc", content_hash="p6-pub"),
            Document(source_type="pdf", title="Second Phase6 Doc", content_hash="p6-second"),
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


def test_documents_lists_corpus(db_session: Session, client: TestClient) -> None:
    _seed_docs(db_session)
    with _bind_db(db_session):
        listed = client.get("/documents").json()
    titles = {d["title"] for d in listed}
    assert {"Public Phase6 Doc", "Second Phase6 Doc"} <= titles


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


def _seed_md_doc(session: Session) -> Document:
    doc = Document(
        source_type="markdown",
        title="MD Doc",
        content_hash="md-doc",
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
    doc = Document(source_type="pdf", title="Legacy", content_hash="legacy-1")
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


# --------------------------------------------------- Schreibwege abschaltbar (ADR-0024)


def test_write_routes_are_gone_when_disabled(
    db_session: Session, client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Ohne WRITES_ENABLED existieren die drei Schreibrouten nach aussen nicht.

    404 statt 403 ist Absicht: ein 403 verriete, dass es den Endpunkt gibt und nur
    der Schluessel fehlt.
    """
    monkeypatch.setattr(get_settings(), "writes_enabled", False, raising=False)
    doc = _seed_md_doc(db_session)
    admin = {"X-API-Key": ADMIN_KEY}
    with _bind_db(db_session):
        post = client.post("/ingest?filename=a.md", content=b"# x", headers=admin)
        assert post.status_code == 404
        put = client.put(f"/documents/{doc.id}/content", json={"content": "# Neu"}, headers=admin)
        assert put.status_code == 404
        assert client.delete(f"/documents/{doc.id}", headers=admin).status_code == 404
    # Der Ausschalter darf nichts loeschen.
    assert db_session.get(Document, doc.id) is not None


def test_reads_stay_open_when_writes_are_disabled(
    db_session: Session, client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Nur die Schreibwege sind zu — Lesen bleibt oeffentlich."""
    monkeypatch.setattr(get_settings(), "writes_enabled", False, raising=False)
    doc = _seed_md_doc(db_session)
    with _bind_db(db_session):
        assert client.get("/documents").status_code == 200
        assert client.get(f"/documents/{doc.id}").status_code == 200
