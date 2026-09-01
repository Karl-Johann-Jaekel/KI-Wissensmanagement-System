"""LLM extraction: parsing + normalization + pending storage with provenance."""

from __future__ import annotations

import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.corpus.aliases import normalize_entity
from app.corpus.extract import (
    ExtractedFacts,
    ExtractionParseError,
    _extract_with_retry,
    parse_extraction,
    store_facts,
)
from app.db.models import Document, GraphEdge, GraphNode


def test_normalize_entity_aliases() -> None:
    assert normalize_entity("RAG") == "Retrieval-Augmented Generation"
    assert normalize_entity("retrieval-augmented generation") == "Retrieval-Augmented Generation"
    assert normalize_entity("  BERT  ") == "BERT"  # unknown keeps case
    assert normalize_entity("") == ""


def test_parse_extraction_tolerates_prose_and_fences() -> None:
    raw = (
        'Sure!\n```json\n{"concepts": ["RAG"], "models": [], "datasets": [], "relations": []}\n```'
    )
    facts = parse_extraction(raw)
    assert facts.concepts == ["RAG"]


def test_parse_extraction_raises_instead_of_returning_nothing() -> None:
    """Ein unlesbares Ergebnis muss als Fehler ankommen (U3).

    Vorher kam ein leeres ExtractedFacts() zurueck, der Aufrufer setzte
    facts_extracted, und das Paper war ohne --force fuer immer verloren.
    """
    with pytest.raises(ExtractionParseError):
        parse_extraction("no json here")
    with pytest.raises(ExtractionParseError):
        parse_extraction('{"concepts": [unquoted]}')
    with pytest.raises(ExtractionParseError):
        parse_extraction("[1, 2, 3]")  # JSON, aber kein Objekt


def test_retry_recovers_when_the_model_adds_prose() -> None:
    """Einmal nachfassen, statt ein Paper wegen fehlender Klammern zu verlieren."""
    answers = iter(
        [
            "Gerne! Hier ist eine Zusammenfassung ohne jedes JSON.",
            '{"concepts": ["RAG"], "models": [], "datasets": [], "relations": []}',
        ]
    )
    calls: list[int] = []

    def chat(messages: list[dict]) -> str:
        calls.append(len(messages))
        return next(answers)

    facts = _extract_with_retry(chat, [{"role": "user", "content": "x"}], "Titel")
    assert facts.concepts == ["RAG"]
    # Der zweite Aufruf traegt den zusaetzlichen Hinweis.
    assert calls == [1, 2]


def test_retry_gives_up_after_the_second_attempt() -> None:
    def chat(messages: list[dict]) -> str:
        return "weiterhin kein JSON"

    with pytest.raises(ExtractionParseError):
        _extract_with_retry(chat, [{"role": "user", "content": "x"}], "Titel")


def _reset(session: Session) -> None:
    session.execute(text("DELETE FROM graph_nodes"))


def test_store_facts_creates_pending_entities_with_provenance(db_session: Session) -> None:
    _reset(db_session)
    doc = Document(
        source_type="arxiv_pdf",
        title="Attention Is All You Need",
        uri="http://arxiv.org/abs/1706.03762",
        content_hash="hash-attn",
        meta={"id": "1706.03762"},
    )
    db_session.add(doc)
    db_session.flush()

    facts = ExtractedFacts(
        concepts=["RAG", "Retrieval Augmented Generation", "Self-Attention"],
        models=["Transformer"],
        datasets=["WMT"],
        relations=[],
    )
    n_nodes, n_edges = store_facts(db_session, doc, facts)
    db_session.commit()

    # "RAG" and "Retrieval Augmented Generation" collapse to one node
    rag = db_session.execute(
        select(GraphNode).where(GraphNode.name == "Retrieval-Augmented Generation")
    ).scalar_one()
    assert rag.status == "pending"
    assert rag.kind == "concept"

    paper = db_session.execute(
        select(GraphNode).where(GraphNode.kind == "paper", GraphNode.name == doc.title)
    ).scalar_one()
    assert paper.status == "verified"

    edge = db_session.execute(
        select(GraphEdge).where(GraphEdge.source == paper.id, GraphEdge.target == rag.id)
    ).scalar_one()
    assert edge.status == "pending"
    assert edge.meta["source_document_ids"] == [str(doc.id)]  # provenance mandatory
    assert n_edges >= 3


def test_edges_are_not_attached_to_rejected_nodes(db_session: Session) -> None:
    """Ein verworfener Knoten darf nicht bei jedem Lauf neue pending-Kanten sammeln.

    Er behaelt seinen Status (richtig so), wird von der Promotion aber fuer immer
    uebersprungen — der Rest wuechse sonst und loeste sich nie auf.
    """
    _reset(db_session)
    from app.db.graph import upsert_node

    rejected = upsert_node(db_session, "concept", "Verworfener Begriff", status="rejected")
    db_session.commit()

    doc = Document(source_type="pdf", title="Ein Paper", content_hash="rejected-edge-test")
    db_session.add(doc)
    db_session.flush()

    store_facts(db_session, doc, ExtractedFacts(concepts=["Verworfener Begriff"]))
    db_session.commit()

    edges = (
        db_session.execute(select(GraphEdge).where(GraphEdge.target == rejected)).scalars().all()
    )
    assert edges == []
    # Der Knoten selbst bleibt unangetastet.
    assert (
        db_session.execute(
            text("SELECT status FROM graph_nodes WHERE name='Verworfener Begriff'")
        ).scalar_one()
        == "rejected"
    )
