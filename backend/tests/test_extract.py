"""LLM extraction: parsing + normalization + pending storage with provenance."""

from __future__ import annotations

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.corpus.aliases import normalize_entity
from app.corpus.extract import ExtractedFacts, parse_extraction, store_facts
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
    assert parse_extraction("no json here").concepts == []


def _reset(session: Session) -> None:
    session.execute(text("DELETE FROM graph_nodes"))


def test_store_facts_creates_pending_entities_with_provenance(db_session: Session) -> None:
    _reset(db_session)
    doc = Document(
        source_type="arxiv_pdf",
        title="Attention Is All You Need",
        uri="http://arxiv.org/abs/1706.03762",
        content_hash="hash-attn",
        sensitivity="public",
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
