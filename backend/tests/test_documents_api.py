"""Documents API + admin gating (PLAN §7 Phase 6)."""

from __future__ import annotations

from collections.abc import Iterator

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models import Document
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
