"""Provenienz-Schema (Migration 0005, ADR-0020).

Braucht Postgres — die tragenden Regeln sind CHECK-Constraints und
``ON CONFLICT``-Verhalten, beides gibt es nur in der echten Datenbank.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.corpus.harvest.base import DbSink, HarvestRecord
from app.db.graph import upsert_edge, upsert_node
from app.db.provenance import (
    Claim,
    find_duplicate_source,
    independent_source_count,
    mark_conflict,
    name_key,
    record_authors,
    record_extraction,
    record_source,
    sources_for,
)


def _reset(session: Session) -> None:
    session.execute(text("DELETE FROM entities_extracted"))
    session.execute(text("DELETE FROM document_authors"))
    session.execute(text("DELETE FROM authors"))
    session.execute(text("DELETE FROM document_sources"))
    session.execute(text("DELETE FROM graph_nodes"))


# --------------------------------------------------------------- Quellen


def test_record_source_is_idempotent(db_session: Session) -> None:
    _reset(db_session)
    first = record_source(
        db_session, source_system="arxiv", source_id="2005.11401", fetched_by="test"
    )
    second = record_source(
        db_session, source_system="arxiv", source_id="2005.11401", fetched_by="test"
    )
    assert first == second
    count = db_session.execute(text("SELECT count(*) FROM document_sources")).scalar_one()
    assert count == 1


def test_record_source_never_drops_a_known_document_link(db_session: Session) -> None:
    """Ein späterer Lauf ohne Dokumentbezug darf den bestehenden nicht löschen."""
    _reset(db_session)
    doc_id = db_session.execute(
        text(
            "INSERT INTO documents (source_type, title, content_hash) "
            "VALUES ('arxiv_pdf', 'T', 'h-prov-1') RETURNING id"
        )
    ).scalar_one()
    record_source(
        db_session,
        source_system="arxiv",
        source_id="1",
        fetched_by="t",
        document_id=str(doc_id),
        doi="10.1/x",
    )
    record_source(db_session, source_system="arxiv", source_id="1", fetched_by="t")
    row = db_session.execute(
        text("SELECT document_id, doi FROM document_sources WHERE source_id='1'")
    ).one()
    assert row.document_id == doc_id
    assert row.doi == "10.1/x"


def test_the_same_work_from_two_systems_yields_two_rows(db_session: Session) -> None:
    """Kein Überschreiben mehr — das war die Grenze aus ADR-0017."""
    _reset(db_session)
    record_source(
        db_session,
        source_system="arxiv",
        source_id="2005.11401",
        fetched_by="t",
        doi="10.1/rag",
        title_key="retrieval augmented generation",
    )
    record_source(
        db_session,
        source_system="openreview",
        source_id="abc",
        fetched_by="t",
        doi="10.1/rag",
        title_key="retrieval augmented generation",
    )
    count = db_session.execute(text("SELECT count(*) FROM document_sources")).scalar_one()
    assert count == 2


def test_find_duplicate_source_matches_doi_or_title(db_session: Session) -> None:
    _reset(db_session)
    record_source(
        db_session,
        source_system="arxiv",
        source_id="1",
        fetched_by="t",
        doi="10.1/x",
        title_key="ein titel",
    )
    assert find_duplicate_source(db_session, doi="10.1/x", title_key=None) is not None
    assert find_duplicate_source(db_session, doi=None, title_key="ein titel") is not None
    assert find_duplicate_source(db_session, doi="10.9/z", title_key="anders") is None
    assert find_duplicate_source(db_session, doi=None, title_key=None) is None


# --------------------------------------------------------------- Autor:innen


def test_authors_reject_contact_data_in_the_database(db_session: Session) -> None:
    """Die Regel steht als CHECK, nicht nur in der Anwendung."""
    _reset(db_session)
    with pytest.raises(IntegrityError):
        db_session.execute(
            text(
                "INSERT INTO authors (source_system, name, name_key) "
                "VALUES ('arxiv', 'Ada ada@example.org', 'ada')"
            )
        )
    db_session.rollback()

    with pytest.raises(IntegrityError):
        db_session.execute(
            text(
                "INSERT INTO authors (source_system, name, name_key, meta) "
                "VALUES ('arxiv', 'Ada', 'ada', '{\"email\": \"ada@example.org\"}')"
            )
        )
    db_session.rollback()


def test_record_authors_drops_broken_names_instead_of_repairing_them(
    db_session: Session,
) -> None:
    _reset(db_session)
    ids = record_authors(
        db_session,
        ["Ada Lovelace", "alan@example.org", "  ", "Alan Turing"],
        source_system="arxiv",
        meta={"email": "x@y.z", "orcid": "0000"},
    )
    assert len(ids) == 2
    names = db_session.execute(text("SELECT name FROM authors ORDER BY name")).scalars().all()
    assert names == ["Ada Lovelace", "Alan Turing"]
    meta = db_session.execute(
        text("SELECT meta FROM authors WHERE name='Ada Lovelace'")
    ).scalar_one()
    assert meta == {"orcid": "0000"}


def test_author_identity_is_scoped_per_source_system(db_session: Session) -> None:
    """Namen quellenübergreifend zu verschmelzen wäre Profilbildung — wird nicht getan."""
    _reset(db_session)
    record_authors(db_session, ["Ada Lovelace"], source_system="arxiv")
    record_authors(db_session, ["Ada Lovelace"], source_system="openreview")
    count = db_session.execute(text("SELECT count(*) FROM authors")).scalar_one()
    assert count == 2


def test_name_key_folds_case_and_punctuation() -> None:
    assert name_key("Küttler, Heinrich") == "küttler heinrich"
    assert name_key("  A.  Lovelace ") == "a lovelace"
    assert name_key("") == ""


# --------------------------------------------------------------- Belege


def test_two_sources_for_one_node_are_two_rows(db_session: Session) -> None:
    """Der eigentliche Zweck der Tabelle: Mehrfach-Provenienz je Aussage."""
    _reset(db_session)
    node = upsert_node(db_session, "concept", "Dense Passage Retrieval")
    own = record_source(db_session, source_system="arxiv", source_id="a1", fetched_by="t")
    foreign = record_source(
        db_session, source_system="paperswithcode", source_id="dump", fetched_by="t"
    )
    record_extraction(db_session, Claim(node_id=node), extractor="llm:mistral", source_id=own)
    record_extraction(db_session, Claim(node_id=node), extractor="rule:pwc", source_id=foreign)

    assert sources_for(db_session, Claim(node_id=node)) == ["arxiv", "paperswithcode"]
    assert independent_source_count(db_session, Claim(node_id=node)) == 2


def test_record_extraction_is_idempotent(db_session: Session) -> None:
    _reset(db_session)
    node = upsert_node(db_session, "concept", "RAG")
    source = record_source(db_session, source_system="arxiv", source_id="a1", fetched_by="t")
    first = record_extraction(
        db_session, Claim(node_id=node), extractor="rule:pwc", source_id=source
    )
    second = record_extraction(
        db_session, Claim(node_id=node), extractor="rule:pwc", source_id=source
    )
    assert first == second


def test_extraction_can_reference_an_edge(db_session: Session) -> None:
    _reset(db_session)
    paper = upsert_node(db_session, "paper", "Ein Paper")
    concept = upsert_node(db_session, "concept", "Ein Konzept")
    upsert_edge(db_session, paper, concept, "INTRODUCES")
    db_session.commit()
    claim = Claim(edge=(paper, concept, "INTRODUCES"))
    record_extraction(db_session, claim, extractor="llm:mistral", confidence=0.8)
    assert independent_source_count(db_session, claim) == 0  # ohne Quelle kein Beleg
    count = db_session.execute(
        text("SELECT count(*) FROM entities_extracted WHERE edge_relation='INTRODUCES'")
    ).scalar_one()
    assert count == 1


def test_a_claim_must_point_at_something(db_session: Session) -> None:
    _reset(db_session)
    with pytest.raises(IntegrityError):
        db_session.execute(text("INSERT INTO entities_extracted (extractor) VALUES ('rule:none')"))
    db_session.rollback()


def test_conflicts_are_marked_and_never_cleared_by_a_later_run(db_session: Session) -> None:
    """PLAN §2.7: markieren, nicht überschreiben — auch nicht durch Erneut-Importieren."""
    _reset(db_session)
    node = upsert_node(db_session, "model", "Ein Modell")
    source = record_source(db_session, source_system="arxiv", source_id="a1", fetched_by="t")
    claim = Claim(node_id=node)
    record_extraction(db_session, claim, extractor="llm:mistral", source_id=source)

    assert mark_conflict(db_session, claim, "widersprüchliche Angabe") == 1
    # Ein weiterer Lauf setzt conflict=False — das darf die Markierung nicht löschen.
    record_extraction(db_session, claim, extractor="llm:mistral", source_id=source)
    row = db_session.execute(text("SELECT conflict, conflict_reason FROM entities_extracted")).one()
    assert row.conflict is True
    assert row.conflict_reason == "widersprüchliche Angabe"


def test_deleting_a_node_removes_its_claims(db_session: Session) -> None:
    """Löschpfad: Ein entfernter Knoten hinterlässt keine verwaisten Belege."""
    _reset(db_session)
    node = upsert_node(db_session, "concept", "Vergänglich")
    source = record_source(db_session, source_system="arxiv", source_id="a1", fetched_by="t")
    record_extraction(db_session, Claim(node_id=node), extractor="rule:pwc", source_id=source)
    db_session.execute(text("DELETE FROM graph_nodes WHERE id = :i"), {"i": node})
    count = db_session.execute(text("SELECT count(*) FROM entities_extracted")).scalar_one()
    assert count == 0


# --------------------------------------------------------------- Harvester-Naht


def test_db_sink_writes_a_source_row_without_a_document(db_session: Session) -> None:
    """Der Harvester kennt den Datensatz, bevor es ein Dokument gibt (ADR-0018)."""
    _reset(db_session)
    record = HarvestRecord(
        source="arxiv",
        source_id="2505.17810",
        title="VIBE: Vector Index Benchmark for Embeddings",
        source_url="https://arxiv.org/abs/2505.17810",
        fetched_at="2026-08-18T00:00:00+00:00",
        fetched_by="harvester",
        authors=["Elias Jääsaari"],
        abstract_index={"vector": [0, 5]},
        extra={"license": "arxiv-nonexclusive"},
    )
    sink = DbSink(db_session, commit_every=10_000)
    sink(record)
    sink(record)  # zweiter Lauf: keine zweite Zeile

    row = db_session.execute(
        text("SELECT document_id, license, title_key, meta FROM document_sources")
    ).one()
    assert row.document_id is None
    assert row.license == "arxiv-nonexclusive"
    assert row.title_key == "vibe vector index benchmark for embeddings"
    # Abstract bleibt invertiert; ein Rohtext-Feld existiert nirgends.
    assert row.meta["abstract_index"] == {"vector": [0, 5]}
    assert "abstract" not in row.meta
    names = db_session.execute(text("SELECT name FROM authors")).scalars().all()
    assert names == ["Elias Jääsaari"]
