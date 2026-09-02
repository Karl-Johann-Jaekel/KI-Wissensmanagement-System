"""Promotion rules: 2-source + confidence -> verified; reciprocal IMPROVES_ON disputed."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.corpus.promote import promote_graph
from app.db.graph import upsert_edge, upsert_node
from app.db.models import Document
from app.db.provenance import Claim, record_extraction


def _reset(session: Session) -> None:
    session.execute(text("DELETE FROM graph_nodes"))


def _document(session: Session, key: str) -> str:
    """Ein Dokument als Herkunft eines Belegs."""
    doc = Document(source_type="pdf", title=f"Doc {key}", content_hash=f"promote-{key}")
    session.add(doc)
    session.flush()
    return str(doc.id)


def _evidence(session: Session, node_id: str, document_id: str) -> None:
    """Beleg festhalten — genau das tut store_facts in der Extraktion (ADR-0020).

    Seit ADR-0022 zaehlt die Promotion hier und nicht mehr im JSONB-Feld, das der
    Upsert ersetzte statt es zu ergaenzen.
    """
    record_extraction(session, Claim(node_id=node_id), extractor="test", document_id=document_id)


def _status(session: Session, kind: str, name: str) -> str:
    return session.execute(
        text("SELECT status FROM graph_nodes WHERE kind=:k AND name=:n"), {"k": kind, "n": name}
    ).scalar_one()


def test_two_sources_promote_single_source_stays_pending(db_session: Session) -> None:
    _reset(db_session)
    d1, d2 = _document(db_session, "1"), _document(db_session, "2")
    p1 = upsert_node(db_session, "paper", "Paper 1", status="verified")
    p2 = upsert_node(db_session, "paper", "Paper 2", status="verified")
    two = upsert_node(db_session, "concept", "Popular Concept", status="pending")
    one = upsert_node(db_session, "concept", "Lonely Concept", status="pending")
    upsert_edge(
        db_session,
        p1,
        two,
        "INTRODUCES",
        meta={"source_document_ids": ["d1"], "confidence": 0.9},
        status="pending",
    )
    upsert_edge(
        db_session,
        p2,
        two,
        "INTRODUCES",
        meta={"source_document_ids": ["d2"], "confidence": 0.8},
        status="pending",
    )
    upsert_edge(
        db_session,
        p1,
        one,
        "INTRODUCES",
        meta={"source_document_ids": ["d1"], "confidence": 0.9},
        status="pending",
    )
    _evidence(db_session, two, d1)
    _evidence(db_session, two, d2)
    _evidence(db_session, one, d1)
    db_session.commit()

    # Schwellen explizit: die Regel wird getestet, nicht die .env des Betreibers
    # (seit ADR-0010 sind PROMOTE_MIN_SOURCES/-CONFIDENCE konfigurierbar).
    stats = promote_graph(db_session, min_sources=2, confidence_threshold=0.7)
    assert stats.promoted_nodes == 1
    assert _status(db_session, "concept", "Popular Concept") == "verified"
    assert _status(db_session, "concept", "Lonely Concept") == "pending"

    promoted = db_session.execute(
        text("SELECT meta FROM graph_nodes WHERE name='Popular Concept'")
    ).scalar_one()
    assert len(promoted["source_document_ids"]) == 2  # provenance recorded


def test_min_sources_one_promotes_single_source_facts(db_session: Session) -> None:
    """Gelockerte Schwelle (ADR-0010): einquellige Fakten werden übernommen."""
    _reset(db_session)
    d1 = _document(db_session, "solo")
    p1 = upsert_node(db_session, "paper", "Solo Paper", status="verified")
    lonely = upsert_node(db_session, "concept", "Solo Concept", status="pending")
    upsert_edge(
        db_session,
        p1,
        lonely,
        "INTRODUCES",
        meta={"source_document_ids": ["d1"], "confidence": 0.9},
        status="pending",
    )
    _evidence(db_session, lonely, d1)
    db_session.commit()

    assert promote_graph(db_session, min_sources=2).promoted_nodes == 0
    assert promote_graph(db_session, min_sources=1).promoted_nodes == 1
    assert _status(db_session, "concept", "Solo Concept") == "verified"


def test_low_confidence_stays_pending(db_session: Session) -> None:
    _reset(db_session)
    p1 = upsert_node(db_session, "paper", "P1", status="verified")
    p2 = upsert_node(db_session, "paper", "P2", status="verified")
    c = upsert_node(db_session, "concept", "Weak Concept", status="pending")
    upsert_edge(
        db_session,
        p1,
        c,
        "INTRODUCES",
        meta={"source_document_ids": ["d1"], "confidence": 0.4},
        status="pending",
    )
    upsert_edge(
        db_session,
        p2,
        c,
        "INTRODUCES",
        meta={"source_document_ids": ["d2"], "confidence": 0.3},
        status="pending",
    )
    db_session.commit()
    promote_graph(db_session)
    assert _status(db_session, "concept", "Weak Concept") == "pending"


def test_reciprocal_improves_on_is_disputed(db_session: Session) -> None:
    _reset(db_session)
    a = upsert_node(db_session, "model", "Model A", status="verified")
    b = upsert_node(db_session, "model", "Model B", status="verified")
    upsert_edge(
        db_session,
        a,
        b,
        "IMPROVES_ON",
        meta={"source_document_ids": ["d1"], "confidence": 0.9},
        status="pending",
    )
    upsert_edge(
        db_session,
        b,
        a,
        "IMPROVES_ON",
        meta={"source_document_ids": ["d2"], "confidence": 0.9},
        status="pending",
    )
    db_session.commit()

    stats = promote_graph(db_session)
    assert stats.disputed == 2
    disputed = db_session.execute(
        text("SELECT count(*) FROM graph_edges WHERE relation='IMPROVES_ON' AND status='pending'")
    ).scalar_one()
    assert disputed == 2  # both left pending, flagged
    flagged = db_session.execute(
        text("SELECT meta->>'disputed' FROM graph_edges LIMIT 1")
    ).scalar_one()
    assert flagged == "true"


def test_promotion_counts_evidence_not_the_jsonb_field(db_session: Session) -> None:
    """Der Kern von ADR-0022: gezählt wird in entities_extracted.

    Aufgebaut wie der reale Verlust: zwei Papers behaupten *dieselbe* Kante. Vorher
    trafen beide denselben Primärschlüssel und die Quelle des ersten verschwand aus
    dem JSONB-Feld — der Knoten blieb einquellig und wurde nie promotet.
    """
    _reset(db_session)
    d1, d2 = _document(db_session, "a"), _document(db_session, "b")
    paper = upsert_node(db_session, "paper", "Gemeinsames Paper", status="verified")
    concept = upsert_node(db_session, "concept", "Doppelt belegt", status="pending")

    upsert_edge(
        db_session,
        paper,
        concept,
        "INTRODUCES",
        meta={"source_document_ids": [d1], "confidence": 0.9},
        status="pending",
    )
    upsert_edge(
        db_session,
        paper,
        concept,
        "INTRODUCES",
        meta={"source_document_ids": [d2], "confidence": 0.8},
        status="pending",
    )
    _evidence(db_session, concept, d1)
    _evidence(db_session, concept, d2)
    db_session.commit()

    assert promote_graph(db_session, min_sources=2, confidence_threshold=0.7).promoted_nodes == 1
    meta = db_session.execute(
        text("SELECT meta FROM graph_nodes WHERE name='Doppelt belegt'")
    ).scalar_one()
    assert meta["independent_sources"] == 2


def test_node_without_evidence_is_never_promoted(db_session: Session) -> None:
    """Ohne Beleg keine Promotion — Provenienz ist Pflicht (PLAN §2.7).

    Das JSONB-Feld allein reicht nicht mehr: es traegt keine Gewaehr dafuer, dass
    die Quellen jemals vollstaendig waren.
    """
    _reset(db_session)
    paper = upsert_node(db_session, "paper", "P", status="verified")
    orphan = upsert_node(db_session, "concept", "Ohne Beleg", status="pending")
    upsert_edge(
        db_session,
        paper,
        orphan,
        "INTRODUCES",
        meta={"source_document_ids": ["d1", "d2", "d3"], "confidence": 0.99},
        status="pending",
    )
    db_session.commit()

    assert promote_graph(db_session, min_sources=2).promoted_nodes == 0
    assert _status(db_session, "concept", "Ohne Beleg") == "pending"
