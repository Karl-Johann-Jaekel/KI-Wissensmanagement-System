"""Papers-with-Code-Adapter (ADR-0017).

Der Normalisierungsteil läuft ohne DB und ohne Netz gegen einen Mini-Dump; die
Idempotenz der Upserts braucht Postgres und wird sonst übersprungen.
"""

from __future__ import annotations

import gzip
import json
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.corpus.pwc import (
    build_graph,
    load_dump,
    paper_markdown,
    repo_name,
    select_papers,
    write_graph,
)

PAPERS = [
    {
        "title": "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
        "arxiv_id": "2005.11401",
        "url_abs": "https://arxiv.org/abs/2005.11401",
        "abstract": "We explore a general-purpose fine-tuning recipe for retrieval.",
        "date": "2020-05-22",
        "authors": ["Patrick Lewis", "Ethan Perez"],
        "tasks": ["Question Answering", "Open-Domain Question Answering"],
        "methods": [{"name": "Dense Passage Retrieval"}],
    },
    {
        "title": "ReAct: Synergizing Reasoning and Acting in Language Models",
        "arxiv_id": "2210.03629",
        "url_abs": "https://arxiv.org/abs/2210.03629",
        "abstract": "We explore the use of LLMs to generate reasoning traces and actions.",
        "date": "2022-10-06",
        "authors": ["Shunyu Yao"],
        "tasks": ["Question Answering"],
        "methods": [],
    },
    {"title": "-", "abstract": "noise"},
]

LINKS = [
    {
        "paper_title": "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
        "repo_url": "https://github.com/huggingface/transformers",
        "is_official": True,
        "framework": "pytorch",
    },
    {
        "paper_title": "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
        "repo_url": "https://github.com/community/rag-demo/",
        "is_official": False,
        "framework": "none",
    },
    {"paper_title": "Some Paper Not In The Subset", "repo_url": "https://github.com/x/y"},
]

EVALUATION = [
    {
        "task": "Question Answering",
        "subtasks": [
            {
                "task": "Open-Domain Question Answering",
                "datasets": [
                    {
                        "dataset": "Natural Questions",
                        "sota": {
                            "rows": [
                                {
                                    "model_name": "RAG-Sequence",
                                    "paper_title": (
                                        "Retrieval-Augmented Generation for "
                                        "Knowledge-Intensive NLP Tasks"
                                    ),
                                    "metrics": {"EM": "44.5"},
                                }
                            ]
                        },
                    },
                    {
                        "dataset": "Unrelated Bench",
                        "sota": {"rows": [{"model_name": "X", "paper_title": "Nope"}]},
                    },
                ],
            }
        ],
        "datasets": [],
    }
]

DATASETS = [
    {"name": "Natural Questions", "full_name": "Natural Questions", "url": "https://ai.google/nq"},
    {"name": "Unrelated Bench", "full_name": "Unrelated", "url": "https://example.org"},
]


def _graph():
    papers = select_papers(PAPERS, limit=10)
    return build_graph(
        papers,
        links=LINKS,
        evaluation=EVALUATION,
        datasets=DATASETS,
        fetched_at="2026-08-18T00:00:00+00:00",
    )


def test_select_papers_drops_noise_and_respects_limit() -> None:
    assert len(select_papers(PAPERS, limit=10)) == 2  # "-" ist zu kurz
    assert len(select_papers(PAPERS, limit=1)) == 1


def test_select_papers_match_filters_on_title_abstract_and_tasks() -> None:
    titles = [p["title"] for p in select_papers(PAPERS, limit=10, match="reasoning traces")]
    assert titles == ["ReAct: Synergizing Reasoning and Acting in Language Models"]
    # Treffer nur über die Task-Liste
    assert len(select_papers(PAPERS, limit=10, match="open-domain")) == 1


def test_select_papers_dedupes_by_canonical_title() -> None:
    doubled = [*PAPERS, {"title": "  react: synergizing reasoning and acting in language models "}]
    assert len(select_papers(doubled, limit=10)) == 2


def test_repo_name_shortens_to_owner_repo() -> None:
    assert repo_name("https://github.com/huggingface/transformers") == "huggingface/transformers"
    assert repo_name("https://github.com/community/rag-demo/") == "community/rag-demo"
    assert repo_name("") == ""


def test_build_graph_produces_the_five_entity_kinds() -> None:
    counts = _graph().counts()
    assert counts["paper"] == 2
    assert counts["repo"] == 2
    assert counts["task"] == 2
    assert counts["dataset"] == 1  # "Unrelated Bench" hängt an keinem Paper der Teilmenge
    assert counts["model"] == 1
    assert counts["concept"] == 1


def test_build_graph_edges_carry_the_pwc_relations() -> None:
    graph = _graph()
    relations = {rel for _s, _t, rel in graph.edges}
    assert {"IMPLEMENTS", "USES_DATASET", "ACHIEVES_SOTA", "RELATED_TO", "USES"} <= relations
    official = graph.edges[
        (
            ("repo", "huggingface/transformers"),
            ("paper", PAPERS[0]["title"]),
            "IMPLEMENTS",
        )
    ]
    community = graph.edges[
        (("repo", "community/rag-demo"), ("paper", PAPERS[0]["title"]), "IMPLEMENTS")
    ]
    assert official["weight"] > community["weight"]


def test_every_node_and_edge_carries_provenance() -> None:
    graph = _graph()
    for meta in graph.nodes.values():
        prov = meta["provenance"]
        assert prov["source"] == "paperswithcode"
        assert prov["license"] == "CC-BY-SA-4.0"
        assert prov["fetched_at"] == "2026-08-18T00:00:00+00:00"
    for payload in graph.edges.values():
        assert payload["meta"]["provenance"]["source"] == "paperswithcode"


def test_paper_meta_keeps_author_names_but_no_contact_data() -> None:
    meta = _graph().nodes[("paper", PAPERS[0]["title"])]
    assert meta["authors"] == ["Patrick Lewis", "Ethan Perez"]
    assert not any("@" in str(v) for v in meta.values() if isinstance(v, str))


def test_sota_row_of_a_foreign_paper_is_ignored() -> None:
    assert ("dataset", "Unrelated Bench") not in _graph().nodes


def test_dataset_enrichment_only_touches_linked_datasets() -> None:
    assert _graph().nodes[("dataset", "Natural Questions")]["url"] == "https://ai.google/nq"


def test_paper_markdown_is_empty_without_abstract() -> None:
    assert paper_markdown({"title": "T", "abstract": ""}) == ""
    assert paper_markdown(PAPERS[0]).startswith("# Retrieval-Augmented Generation")


def test_load_dump_reads_plain_and_gzipped(tmp_path: Path) -> None:
    assert load_dump(tmp_path, "papers") is None
    (tmp_path / "papers-with-abstracts.json").write_text(json.dumps(PAPERS), encoding="utf-8")
    assert load_dump(tmp_path, "papers") == PAPERS
    with gzip.open(tmp_path / "datasets.json.gz", "wt", encoding="utf-8") as fh:
        json.dump(DATASETS, fh)
    assert load_dump(tmp_path, "datasets") == DATASETS


def test_write_graph_is_idempotent(db_session: Session) -> None:
    db_session.execute(text("DELETE FROM graph_nodes"))
    graph = _graph()
    write_graph(db_session, graph)
    before = db_session.execute(text("SELECT count(*) FROM graph_edges")).scalar_one()
    nodes_before = db_session.execute(text("SELECT count(*) FROM graph_nodes")).scalar_one()
    write_graph(db_session, graph)  # zweiter Lauf darf nichts hinzufügen
    assert db_session.execute(text("SELECT count(*) FROM graph_edges")).scalar_one() == before
    assert db_session.execute(text("SELECT count(*) FROM graph_nodes")).scalar_one() == nodes_before
    assert nodes_before == 9


def test_write_graph_reuses_existing_spelling(db_session: Session) -> None:
    """Ein Dump-Name in anderer Schreibweise darf keinen zweiten Knoten erzeugen."""
    db_session.execute(text("DELETE FROM graph_nodes"))
    db_session.execute(
        text(
            "INSERT INTO graph_nodes (kind, name, status) "
            "VALUES ('task','Question Answering','verified')"
        )
    )
    db_session.commit()
    graph = build_graph(
        [{"title": "A paper about answering", "tasks": ["question answering"]}],
        fetched_at="2026-08-18T00:00:00+00:00",
    )
    write_graph(db_session, graph)
    names = (
        db_session.execute(text("SELECT name FROM graph_nodes WHERE kind='task'")).scalars().all()
    )
    assert names == ["Question Answering"]
