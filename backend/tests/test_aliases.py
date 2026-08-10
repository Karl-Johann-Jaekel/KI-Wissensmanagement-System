"""Kanonische Entitätsnamen (ADR-0012).

Die Beispiele stammen aus dem echten Bestand nach 56 Papers: dort standen 316
pending-Fakten mit je genau einer Quelle, weil jedes Paper seine eigene
Schreibweise prägte.
"""

from __future__ import annotations

import pytest

from app.corpus.aliases import (
    canonical_key,
    is_plausible_entity,
    normalize_entity,
    split_entities,
)


@pytest.mark.parametrize(
    ("a", "b"),
    [
        ("Cross-Encoder", "cross encoder"),
        ("Cross-Encoders", "Cross Encoder"),
        ("knowledge graph (KG)", "Knowledge Graphs"),
        ("Reranking", "re-ranking"),
        ("RAG", "Retrieval-Augmented Generation"),
        ("LLMs", "large language model"),
        ("attention mechanism", "Attention"),
        ("WebShop", "Webshop"),
        ("GNN-based retrievers", "GNN based retriever"),
    ],
)
def test_variants_share_one_key(a: str, b: str) -> None:
    assert canonical_key(a) == canonical_key(b) != ""


@pytest.mark.parametrize(
    ("a", "b"),
    [
        ("Dense Retrieval", "Sparse Retrieval"),
        ("Cross-Encoder", "Bi-Encoder"),
        ("ColBERT", "BERT"),
    ],
)
def test_distinct_concepts_keep_distinct_keys(a: str, b: str) -> None:
    assert canonical_key(a) != canonical_key(b)


def test_parenthetical_abbreviation_is_dropped() -> None:
    assert canonical_key("knowledge graph (KG)") == "knowledge graph"
    assert normalize_entity("knowledge graph (KG)") == "Knowledge Graph"


@pytest.mark.parametrize(
    "fragment",
    [
        "existing efforts within these three frameworks",
        "KG tasks (embedding, completion, construction, graph-to-text generation)",
        "segmentation into functional evidence units that carry the argument",
        "various approaches",
        "",
        "  ",
    ],
)
def test_sentence_fragments_are_rejected(fragment: str) -> None:
    assert is_plausible_entity(fragment) is False


@pytest.mark.parametrize(
    "name",
    ["Dense Retrieval", "ColBERT", "M3-Embedding", "late interaction architecture", "RAG"],
)
def test_real_entities_pass(name: str) -> None:
    assert is_plausible_entity(name) is True


def test_enumerations_are_split() -> None:
    raw = "KG-enhanced LLMs, LLM-augmented KGs, Synergized LLMs"
    assert split_entities(raw) == ["KG-enhanced LLMs", "LLM-augmented KGs", "Synergized LLMs"]


def test_single_entity_survives_splitting() -> None:
    assert split_entities("Retrieval-Augmented Generation") == ["Retrieval-Augmented Generation"]
    # Bindestriche und Schrägstriche gehören zum Begriff, nicht zur Aufzählung.
    assert split_entities("encoder/decoder") == ["encoder/decoder"]
