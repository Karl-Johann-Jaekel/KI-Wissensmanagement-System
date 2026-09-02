"""Zusammenführen von Knoten, die sich nur in der Knotenart unterscheiden (U8).

``UNIQUE(kind, name)`` macht die Art zum Teil der Identität: „BERT" kann als
``concept`` **und** als ``model`` im Graphen liegen. Die Belege verteilen sich
dann auf beide, und die Regel „mindestens N unabhängige Quellen" greift bei
keinem.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.db.graph import upsert_edge, upsert_node
from app.db.models import Document, EntityExtraction, GraphEdge, GraphNode
from app.db.provenance import Claim, record_extraction

_CANDIDATES = [
    parent / "scripts" / "merge_duplicate_kinds.py"
    for parent in Path(__file__).resolve().parents[1:3]
]
_SCRIPT = next(p for p in _CANDIDATES if p.exists())
_SPEC = importlib.util.spec_from_file_location("merge_kinds", _SCRIPT)
assert _SPEC and _SPEC.loader
merge = importlib.util.module_from_spec(_SPEC)
# Vor exec_module registrieren: @dataclass schlaegt sonst nach, wo ihr Modul steht,
# und findet nichts.
sys.modules[_SPEC.name] = merge
_SPEC.loader.exec_module(merge)


def _reset(session: Session) -> None:
    session.execute(text("DELETE FROM graph_nodes"))


def _doc(session: Session, key: str) -> str:
    doc = Document(source_type="pdf", title=f"Doc {key}", content_hash=f"merge-{key}")
    session.add(doc)
    session.flush()
    return str(doc.id)


def test_plan_picks_the_kind_with_more_evidence(db_session: Session) -> None:
    _reset(db_session)
    d1, d2 = _doc(db_session, "1"), _doc(db_session, "2")
    as_model = upsert_node(db_session, "model", "BERT")
    as_concept = upsert_node(db_session, "concept", "BERT")
    record_extraction(db_session, Claim(node_id=as_model), extractor="t", document_id=d1)
    record_extraction(db_session, Claim(node_id=as_model), extractor="t", document_id=d2)
    record_extraction(db_session, Claim(node_id=as_concept), extractor="t", document_id=d1)
    db_session.commit()

    plans = [p for p in merge.plan_merges(db_session) if p.winner.name == "BERT"]
    assert len(plans) == 1
    assert str(plans[0].winner.id) == as_model  # zwei Belege schlagen einen
    assert [str(n.id) for n in plans[0].losers] == [as_concept]


def test_apply_moves_edges_and_evidence(db_session: Session) -> None:
    _reset(db_session)
    d1, d2 = _doc(db_session, "a"), _doc(db_session, "b")
    paper = upsert_node(db_session, "paper", "Ein Paper")
    winner = upsert_node(db_session, "model", "BERT")
    loser = upsert_node(db_session, "concept", "BERT")
    record_extraction(db_session, Claim(node_id=winner), extractor="t", document_id=d1)
    record_extraction(db_session, Claim(node_id=winner), extractor="t", document_id=d2)
    record_extraction(db_session, Claim(node_id=loser), extractor="t", document_id=d1)
    upsert_edge(db_session, paper, loser, "INTRODUCES")
    db_session.commit()

    plan = next(p for p in merge.plan_merges(db_session) if p.winner.name == "BERT")
    moved_edges, moved_evidence = merge.apply_merge(db_session, plan)
    db_session.commit()

    # Der Beleg aus d1 liegt bereits am Zielknoten und faellt weg statt zu kollidieren.
    assert (moved_edges, moved_evidence) == (1, 0)
    # Die Kante zeigt jetzt auf den Zielknoten.
    edge = db_session.execute(select(GraphEdge)).scalars().one()
    assert str(edge.target) == winner
    # Alle drei Belege haengen am Zielknoten -> die Quellenzahl stimmt wieder.
    belege = (
        db_session.execute(select(EntityExtraction).where(EntityExtraction.node_id == winner))
        .scalars()
        .all()
    )
    # Zwei unterschiedliche Dokumente — der doppelte Beleg zaehlt nicht zweimal.
    assert len(belege) == 2
    # Der unterlegene Knoten bleibt erhalten, aber aus dem Weg geraeumt.
    gone = db_session.get(GraphNode, loser)
    assert gone is not None
    assert gone.status == "rejected"
    assert gone.meta["merged_into"] == winner


def test_papers_are_never_merged(db_session: Session) -> None:
    """Ein Paper ist keine Entitaet — gleiche Titel unter anderer Art gibt es nicht."""
    _reset(db_session)
    upsert_node(db_session, "paper", "Attention Is All You Need")
    upsert_node(db_session, "concept", "Attention Is All You Need")
    db_session.commit()
    assert merge.plan_merges(db_session) == []


def test_edge_evidence_survives_the_merge(db_session: Session) -> None:
    """Belege am Kanten-Tripel blockieren das Umschreiben der Kante.

    ``fk_entities_extracted_edge`` verweist auf (source, target, relation) und hat
    kein ON UPDATE CASCADE. Ein direktes UPDATE der Kante scheitert deshalb, sobald
    ein Beleg daran haengt — genau so ist das Skript beim ersten Lauf gegen die
    Produktionsdaten abgebrochen. Der lokale Test hatte nur Knoten-Belege und lief
    durch.
    """
    _reset(db_session)
    d1, d2 = _doc(db_session, "e1"), _doc(db_session, "e2")
    paper = upsert_node(db_session, "paper", "Ein Paper")
    winner = upsert_node(db_session, "model", "BERT")
    loser = upsert_node(db_session, "concept", "BERT")
    record_extraction(db_session, Claim(node_id=winner), extractor="t", document_id=d1)
    record_extraction(db_session, Claim(node_id=winner), extractor="t", document_id=d2)
    record_extraction(db_session, Claim(node_id=loser), extractor="t", document_id=d1)

    upsert_edge(db_session, paper, loser, "USES")
    record_extraction(
        db_session, Claim(edge=(paper, loser, "USES")), extractor="t", document_id=d1
    )
    db_session.commit()

    plan = next(p for p in merge.plan_merges(db_session) if p.winner.name == "BERT")
    merge.apply_merge(db_session, plan)
    db_session.commit()

    # Die Kante zeigt auf den Zielknoten …
    edge = db_session.execute(select(GraphEdge)).scalars().one()
    assert (str(edge.source), str(edge.target), edge.relation) == (paper, winner, "USES")
    # … und ihr Beleg ist mitgewandert, statt per Cascade verlorenzugehen.
    belege = (
        db_session.execute(
            select(EntityExtraction).where(EntityExtraction.edge_relation == "USES")
        )
        .scalars()
        .all()
    )
    assert len(belege) == 1
    assert str(belege[0].edge_target) == winner
