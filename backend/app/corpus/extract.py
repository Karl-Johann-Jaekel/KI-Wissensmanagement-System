"""LLM fact extraction: paper -> knowledge-graph facts (PLAN §7 Phase 8).

Everything the LLM produces enters as ``pending`` with mandatory provenance
(``source_document_ids`` on every edge) — no fact is ever trusted on sight (PLAN §2.7).
Promotion to ``verified`` is a separate, rule-based step (``promote.py``). Entity names
are normalised (``aliases.py``) so the graph does not fragment.

The paper node itself is ``verified`` (it is a real ingested document); the extracted
concepts/models/datasets and the edges asserting them are ``pending``.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session, attributes

from app.core.security import estimate_tokens
from app.corpus.aliases import normalize_entity
from app.db.graph import upsert_edge, upsert_node
from app.db.models import Chunk, Document

Chat = Callable[[list[dict]], str]

DEFAULT_CONFIDENCE = 0.8
ENTITY_KINDS = {"concept", "model", "dataset"}
RELATIONS = {"INTRODUCES", "EVALUATES_ON", "IMPROVES_ON", "RELATED_TO"}

SYSTEM_PROMPT = (
    "You extract structured facts for an AI-research knowledge graph. "
    "Return STRICT JSON only — no prose, no markdown fences."
)

USER_TEMPLATE = """Paper title: {title}
Abstract: {abstract}

Extract the paper's key entities and relations. Return JSON with exactly these keys:
{{
  "concepts": ["short canonical method/idea names"],
  "models":   ["named models or systems"],
  "datasets": ["named datasets or benchmarks"],
  "relations": [
    {{"subject": "PAPER or an entity name", "subject_kind": "paper|concept|model|dataset",
      "object": "entity name", "object_kind": "concept|model|dataset",
      "relation": "INTRODUCES|EVALUATES_ON|IMPROVES_ON|RELATED_TO", "confidence": 0.0-1.0}}
  ]
}}
Only include entities actually discussed. Keep names concise. Output JSON only."""

_JSON_RE = re.compile(r"\{.*\}", re.DOTALL)


@dataclass
class ExtractedFacts:
    concepts: list[str] = field(default_factory=list)
    models: list[str] = field(default_factory=list)
    datasets: list[str] = field(default_factory=list)
    relations: list[dict] = field(default_factory=list)


@dataclass
class ExtractStats:
    papers: int = 0
    nodes: int = 0
    edges: int = 0
    skipped: int = 0
    failed: int = 0


def parse_extraction(text: str) -> ExtractedFacts:
    match = _JSON_RE.search(text)
    if not match:
        return ExtractedFacts()
    try:
        data = json.loads(match.group(0))
    except (json.JSONDecodeError, ValueError):
        return ExtractedFacts()

    def _strs(key: str) -> list[str]:
        return [
            str(x) for x in data.get(key, []) if isinstance(x, str | int | float) and str(x).strip()
        ]

    relations = [r for r in data.get("relations", []) if isinstance(r, dict)]
    return ExtractedFacts(
        concepts=_strs("concepts"),
        models=_strs("models"),
        datasets=_strs("datasets"),
        relations=relations,
    )


def build_messages(title: str, abstract: str) -> list[dict]:
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": USER_TEMPLATE.format(title=title, abstract=abstract[:4000])},
    ]


def store_facts(session: Session, doc: Document, facts: ExtractedFacts) -> tuple[int, int]:
    """Persist extracted facts as pending nodes/edges with provenance. Returns (nodes, edges)."""
    doc_id = str(doc.id)
    paper_id = upsert_node(
        session,
        "paper",
        doc.title,
        meta={"arxiv": (doc.meta or {}).get("id"), "uri": doc.uri, "source_document_ids": [doc_id]},
        status="verified",
    )
    node_ids: dict[tuple[str, str], str] = {}
    n_nodes = n_edges = 0

    def ensure(kind: str, raw: str) -> str | None:
        name = normalize_entity(raw)
        if not name:
            return None
        key = (kind, name)
        if key not in node_ids:
            node_ids[key] = upsert_node(session, kind, name, status="pending")
        return node_ids[key]

    def link(src: str, tgt: str, relation: str, confidence: float) -> None:
        nonlocal n_edges
        upsert_edge(
            session,
            src,
            tgt,
            relation,
            weight=round(confidence, 3),
            meta={"source_document_ids": [doc_id], "confidence": round(confidence, 3)},
            status="pending",
        )
        n_edges += 1

    # Default paper -> entity edges guarantee provenance for every entity.
    for kind, names, relation in (
        ("concept", facts.concepts, "INTRODUCES"),
        ("model", facts.models, "INTRODUCES"),
        ("dataset", facts.datasets, "EVALUATES_ON"),
    ):
        for raw in names:
            nid = ensure(kind, raw)
            if nid:
                n_nodes += 1
                link(paper_id, nid, relation, DEFAULT_CONFIDENCE)

    # Explicit entity-to-entity relations from the LLM.
    for rel in facts.relations:
        relation = str(rel.get("relation", "")).upper()
        if relation not in RELATIONS:
            continue
        conf = float(rel.get("confidence", DEFAULT_CONFIDENCE) or DEFAULT_CONFIDENCE)
        s_kind = str(rel.get("subject_kind", "")).lower()
        subj = str(rel.get("subject", ""))
        src = (
            paper_id
            if s_kind == "paper" or subj.upper() == "PAPER"
            else ensure(s_kind if s_kind in ENTITY_KINDS else "concept", subj)
        )
        o_kind = str(rel.get("object_kind", "")).lower()
        tgt = ensure(o_kind if o_kind in ENTITY_KINDS else "concept", str(rel.get("object", "")))
        if src and tgt and src != tgt:
            link(src, tgt, relation, conf)

    return n_nodes, n_edges


def _paper_text(session: Session, doc: Document) -> str:
    abstract = (doc.meta or {}).get("abstract")
    if abstract:
        return str(abstract)
    chunk = session.execute(
        select(Chunk.content)
        .where(Chunk.document_id == doc.id)
        .order_by(Chunk.chunk_index)
        .limit(1)
    ).scalar_one_or_none()
    return chunk or ""


def extract_corpus(
    session: Session,
    *,
    chat: Chat,
    token_budget: int = 200_000,
    limit: int | None = None,
    force: bool = False,
) -> ExtractStats:
    """Extract facts from not-yet-processed corpus documents (idempotent, cost-capped)."""
    stmt = select(Document).where(Document.source_type.in_(("arxiv_pdf", "pdf")))
    docs = session.execute(stmt).scalars().all()
    stats = ExtractStats()
    used_tokens = 0

    for doc in docs:
        if not force and (doc.meta or {}).get("facts_extracted"):
            stats.skipped += 1
            continue
        if limit is not None and stats.papers >= limit:
            break
        abstract = _paper_text(session, doc)
        if not abstract:
            stats.skipped += 1
            continue
        messages = build_messages(doc.title, abstract)
        used_tokens += estimate_tokens(messages[-1]["content"])
        if used_tokens > token_budget:
            print(f"  token budget {token_budget} reached — stopping")
            break
        try:
            facts = parse_extraction(chat(messages))
        except Exception as exc:  # noqa: BLE001 — one bad paper must not abort the run
            print(f"  ! {doc.title[:50]}: {exc}")
            stats.failed += 1
            continue
        n_nodes, n_edges = store_facts(session, doc, facts)
        doc.meta = {**(doc.meta or {}), "facts_extracted": True}
        attributes.flag_modified(doc, "meta")
        session.commit()
        stats.papers += 1
        stats.nodes += n_nodes
        stats.edges += n_edges
        print(f"  ✓ {doc.title[:50]}: +{n_nodes} nodes, +{n_edges} edges")

    return stats
