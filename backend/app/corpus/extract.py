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
from app.corpus.aliases import (
    canonical_key,
    is_plausible_entity,
    normalize_entity,
    split_entities,
)
from app.db.graph import upsert_edge, upsert_node
from app.db.models import Chunk, Document, GraphNode
from app.db.provenance import Claim, record_authors, record_extraction

Chat = Callable[[list[dict]], str]

DEFAULT_CONFIDENCE = 0.8
#: Kennung dieses Schreibwegs in ``entities_extracted`` (ADR-0020).
EXTRACTOR = "llm:extract"
ENTITY_KINDS = {"concept", "model", "dataset"}
RELATIONS = {"INTRODUCES", "EVALUATES_ON", "IMPROVES_ON", "RELATED_TO"}
# So viele bekannte Begriffe bekommt das Modell als Vorschlagsliste zu sehen.
VOCABULARY_LIMIT = 40

SYSTEM_PROMPT = (
    "You extract structured facts for an AI-research knowledge graph. "
    "Return STRICT JSON only — no prose, no markdown fences."
)

USER_TEMPLATE = """Paper title: {title}
Abstract: {abstract}
{vocabulary}
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

Naming rules — these decide whether the graph connects or fragments:
- Prefer an established term from the vocabulary above whenever it fits, even if the
  paper words it differently. Only coin a new name for something genuinely new.
- Use the field's general terminology ("dense retrieval", "reranking"), not the
  paper's private label for its own component.
- One entity per list item. Never pack several into one string.
- 1-4 words, no sentence fragments, no parenthetical abbreviations, no trailing
  explanations. Write "knowledge graph", not "knowledge graph (KG)".

Only include entities actually discussed. Output JSON only."""


def load_vocabulary(session: Session, limit: int = VOCABULARY_LIMIT) -> dict[tuple[str, str], str]:
    """Bekannte Entitäten als ``(kind, canonical_key) -> Anzeigename``.

    Dient doppelt: als Vorschlagsliste im Prompt und als Nachschlagewerk beim
    Speichern, damit eine Schreibvariante auf den bestehenden Knoten zeigt.
    """
    rows = session.execute(
        select(GraphNode.kind, GraphNode.name, GraphNode.status).where(
            GraphNode.kind.in_(tuple(ENTITY_KINDS)), GraphNode.status != "rejected"
        )
    ).all()
    # Verifizierte zuerst: deren Schreibweise gewinnt bei Kollisionen.
    rows = sorted(rows, key=lambda r: r.status != "verified")
    vocab: dict[tuple[str, str], str] = {}
    for kind, name, _status in rows:
        key = canonical_key(name)
        if key:
            vocab.setdefault((kind, key), name)
    return dict(list(vocab.items())[: limit * 4])


def _vocabulary_block(vocab: dict[tuple[str, str], str], limit: int = VOCABULARY_LIMIT) -> str:
    names = sorted({name for (kind, _k), name in vocab.items() if kind == "concept"})[:limit]
    if not names:
        return ""
    return "\nEstablished vocabulary (reuse these exact names when they apply):\n" + ", ".join(
        names
    )


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


def build_messages(
    title: str, abstract: str, vocab: dict[tuple[str, str], str] | None = None
) -> list[dict]:
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": USER_TEMPLATE.format(
                title=title,
                abstract=abstract[:4000],
                vocabulary=_vocabulary_block(vocab or {}),
            ),
        },
    ]


def store_facts(
    session: Session,
    doc: Document,
    facts: ExtractedFacts,
    vocab: dict[tuple[str, str], str] | None = None,
) -> tuple[int, int]:
    """Persist extracted facts as pending nodes/edges with provenance. Returns (nodes, edges)."""
    doc_id = str(doc.id)
    vocab = vocab if vocab is not None else {}
    paper_id = upsert_node(
        session,
        "paper",
        doc.title,
        meta={"arxiv": (doc.meta or {}).get("id"), "uri": doc.uri, "source_document_ids": [doc_id]},
        status="verified",
    )
    # Zusätzlich zum JSONB-Feld ein Beleg je Aussage (ADR-0020). Erst dadurch kann
    # derselbe Knoten von dieser Extraktion **und** von einer Fremdquelle getragen
    # werden, statt dass eine die Provenienz der anderen überschreibt.
    record_extraction(session, Claim(node_id=paper_id), extractor=EXTRACTOR, document_id=doc_id)
    # Autorennamen als eigene Zeilen, ohne Kontaktfelder.
    record_authors(
        session,
        [str(a) for a in ((doc.meta or {}).get("authors") or [])][:20],
        source_system="arxiv",
        document_id=doc_id,
    )
    node_ids: dict[tuple[str, str], str] = {}
    n_nodes = n_edges = 0

    def ensure(kind: str, raw: str) -> str | None:
        """Einen Begriff auf einen Knoten abbilden — vorhandene Schreibweise gewinnt."""
        if not is_plausible_entity(raw):
            return None
        key = canonical_key(raw)
        if not key:
            return None
        # Bekannter Begriff? Dann dessen Anzeigenamen übernehmen statt einen zweiten
        # Knoten für dieselbe Sache anzulegen.
        name = vocab.get((kind, key)) or normalize_entity(raw)
        if not name:
            return None
        vocab.setdefault((kind, key), name)
        cache_key = (kind, key)
        if cache_key not in node_ids:
            node_id = upsert_node(session, kind, name, status="pending")
            node_ids[cache_key] = node_id
            record_extraction(
                session, Claim(node_id=node_id), extractor=EXTRACTOR, document_id=doc_id
            )
        return node_ids[cache_key]

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
        record_extraction(
            session,
            Claim(edge=(src, tgt, relation)),
            extractor=EXTRACTOR,
            document_id=doc_id,
            confidence=round(confidence, 3),
        )
        n_edges += 1

    # Default paper -> entity edges guarantee provenance for every entity.
    for kind, names, relation in (
        ("concept", facts.concepts, "INTRODUCES"),
        ("model", facts.models, "INTRODUCES"),
        ("dataset", facts.datasets, "EVALUATES_ON"),
    ):
        for entry in names:
            # Aufzählungen in einem Feld auftrennen, bevor sie zu einem Knoten werden.
            for raw in split_entities(entry):
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
    # Wächst über den Lauf mit: was Paper 1 benennt, steht Paper 2 zur Verfügung.
    vocab = load_vocabulary(session)

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
        messages = build_messages(doc.title, abstract, vocab)
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
        n_nodes, n_edges = store_facts(session, doc, facts, vocab)
        doc.meta = {**(doc.meta or {}), "facts_extracted": True}
        attributes.flag_modified(doc, "meta")
        session.commit()
        stats.papers += 1
        stats.nodes += n_nodes
        stats.edges += n_edges
        print(f"  ✓ {doc.title[:50]}: +{n_nodes} nodes, +{n_edges} edges")

    return stats
