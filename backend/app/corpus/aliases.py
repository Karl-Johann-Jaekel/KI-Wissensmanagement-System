"""Concept/entity normalization (PLAN §7 Phase 8, §11 "Entity-Wildwuchs").

Two layers:

* ``normalize_entity`` picks the **display name** — known aliases collapse to a
  canonical spelling, unknown entities keep their case (acronyms like BERT must
  survive).
* ``canonical_key`` builds the **identity key** a node is stored under. Case,
  punctuation, hyphenation and simple plurals are folded away, so "Cross-Encoder",
  "cross encoder" and "Cross Encoders" all address the same node (ADR-0012).

Without the second layer every paper coined its own spelling and the graph
fragmented: after 56 papers all 316 pending facts still had exactly one source.
"""

from __future__ import annotations

import re

# lowercase surface form -> canonical display name
ALIASES: dict[str, str] = {
    "rag": "Retrieval-Augmented Generation",
    "retrieval augmented generation": "Retrieval-Augmented Generation",
    "retrieval-augmented generation": "Retrieval-Augmented Generation",
    "dpr": "Dense Passage Retrieval",
    "dense passage retrieval": "Dense Passage Retrieval",
    "dense retrieval": "Dense Retrieval",
    "late interaction": "Late Interaction",
    "rrf": "Reciprocal Rank Fusion",
    "reciprocal rank fusion": "Reciprocal Rank Fusion",
    "cross encoder": "Cross-Encoder",
    "cross-encoder": "Cross-Encoder",
    "bi encoder": "Bi-Encoder",
    "bi-encoder": "Bi-Encoder",
    "reranking": "Reranking",
    "re-ranking": "Reranking",
    "reranker": "Reranking",
    "knowledge graph": "Knowledge Graph",
    "knowledge graphs": "Knowledge Graph",
    "large language model": "Large Language Model",
    "large language models": "Large Language Model",
    "llm": "Large Language Model",
    "llms": "Large Language Model",
    "in context learning": "In-Context Learning",
    "in-context learning": "In-Context Learning",
    "chain of thought": "Chain-of-Thought",
    "chain-of-thought": "Chain-of-Thought",
    "cot": "Chain-of-Thought",
    "self attention": "Self-Attention",
    "self-attention": "Self-Attention",
    "sliding window attention": "Sliding Window Attention",
    "hybrid search": "Hybrid Search",
    "hybrid retrieval": "Hybrid Search",
    "open domain question answering": "Open-Domain Question Answering",
    "open-domain question answering": "Open-Domain Question Answering",
    "odqa": "Open-Domain Question Answering",
    "question answering": "Question Answering",
    "vector search": "Vector Search",
    "semantic search": "Semantic Search",
    "fusion in decoder": "Fusion-in-Decoder",
    "fusion-in-decoder": "Fusion-in-Decoder",
    "fid": "Fusion-in-Decoder",
    "tool use": "Tool Use",
    "agents": "Agents",
    "agent": "Agents",
    "embeddings": "Embeddings",
    "embedding": "Embeddings",
    "text embeddings": "Embeddings",
    "hallucination": "Hallucination",
    "hallucinations": "Hallucination",
    "transformer": "Transformer",
    "transformers": "Transformer",
    "attention": "Attention",
    "attention mechanism": "Attention",
}

_WS = re.compile(r"\s+")
_PUNCT = re.compile(r"[\"'`´“”„()\[\]{},.;:!?]+")
_SEP = re.compile(r"[-_/\\+]+")
# Klammerzusätze sind fast immer Abkürzungen: "knowledge graph (KG)" -> "knowledge graph"
_PAREN = re.compile(r"\s*[(\[][^)\]]*[)\]]")

# Füllwörter, die Extraktionen beliebig anhängen ("attention mechanism" == "attention").
_FILLER = {"the", "a", "an", "of", "for", "based", "method", "methods", "approach", "technique"}

# Marker für Satzfragmente statt Begriffe ("existing efforts within these three frameworks").
_PROSE_MARKERS = {
    "existing",
    "various",
    "several",
    "these",
    "those",
    "which",
    "within",
    "such",
    "our",
    "their",
    "its",
    "this",
    "other",
    "more",
    "between",
    "using",
    "including",
}
MAX_ENTITY_WORDS = 6
MAX_ENTITY_CHARS = 60


def _flatten(text: str) -> str:
    """Kleinschreibung, Klammerzusätze, Satzzeichen und Trenner weg."""
    s = _PAREN.sub(" ", text.strip())
    s = _PUNCT.sub(" ", s.lower())
    s = _SEP.sub(" ", s)
    return _WS.sub(" ", s).strip()


# Aliasschlüssel enthalten Bindestriche ("re-ranking"), die _flatten auflöst — deshalb
# eine zweite Tabelle in flacher Form, sonst greift der Lookup nie.
_FLAT_ALIASES: dict[str, str] = {}


def _singular(word: str) -> str:
    """Grobe Singularform — nur die Fälle, die bei Fachbegriffen wirklich auftreten."""
    if len(word) <= 4 or not word.endswith("s") or word.endswith(("ss", "us", "is", "as", "os")):
        return word
    if word.endswith("ies"):
        return word[:-3] + "y"
    if word.endswith("es") and word[:-2].endswith(("ch", "sh", "x", "z")):
        return word[:-2]
    return word[:-1]


def normalize_entity(name: str) -> str:
    """Display name for an entity. Known aliases collapse; unknowns keep their case."""
    cleaned = _WS.sub(" ", _PAREN.sub(" ", name).strip().strip(".,;:")).strip()
    if not cleaned:
        return ""
    return ALIASES.get(cleaned.lower(), cleaned)


def split_entities(raw: str) -> list[str]:
    """Aufzählungen in einem Feld trennen.

    Extraktionen liefern gelegentlich mehrere Begriffe in einem String
    ("KG-enhanced LLMs, LLM-augmented KGs, Synergized LLMs + KGs"). Kommas und
    Semikolons trennen; Bindestriche und Schrägstriche bleiben Wortbestandteil.
    """
    parts = [p.strip(" .;:") for p in re.split(r"[,;]| and (?=[A-Za-z])", raw)]
    return [p for p in parts if p]


#: Gattungswörter, die allein nie ein Begriff sind — "PAPER" ist der Platzhalter
#: aus dem Extraktionsprompt, "concept" das Feld daneben.
_BARE_CATEGORIES = {
    "paper",
    "concept",
    "model",
    "dataset",
    "task",
    "method",
    "approach",
    "framework",
    "benchmark",
    "baseline",
}

#: Endungen, an denen Mengenangaben erkennbar sind: "… datasets", "… benchmarks".
_CATEGORY_PLURALS = (
    "benchmarks",
    "datasets",
    "tasks",
    "models",
    "methods",
    "baselines",
    "approaches",
    "frameworks",
)

#: Zahlwörter und vage Mengenangaben am Satzanfang.
_QUANTIFIERS = {
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "several",
    "multiple",
    "various",
    "numerous",
    "many",
    "all",
    "both",
    "other",
}

#: Themenfloskeln aus Abstracts — beschreiben den Aufsatz, nicht die Sache.
_TOPIC_PHRASES = ("future research", "quality of", "evaluation of", "related work")


def is_plausible_entity(name: str) -> bool:
    """Filtert heraus, was kein Begriff ist: Satzfragmente und Mengenangaben.

    Mengenangaben sind der zweithäufigste Müll nach den Prosa-Fragmenten: aus
    "wir evaluieren auf vier Benchmark-Datensätzen" wurde ein Knoten
    "four benchmark datasets". Solche Knoten tragen nichts, verbinden nichts und
    tauchten trotzdem im öffentlichen Graphen auf.

    Bewusst zurückhaltend: lieber eine Mengenangabe durchlassen als einen echten
    Eigennamen verwerfen. "STS Benchmark", "MFN Dataset" und "Standard DR-AGG"
    müssen überleben — deshalb greift die Kleinschreibungs-Regel nur, wenn im
    ganzen Namen kein Großbuchstabe steht.
    """
    cleaned = _flatten(name)
    if not cleaned or len(cleaned) < 2:
        return False
    if len(name) > MAX_ENTITY_CHARS:
        return False
    words = cleaned.split(" ")
    if len(words) > MAX_ENTITY_WORDS:
        return False
    if _PROSE_MARKERS.intersection(words):
        return False

    lowered = cleaned.lower()
    if lowered in _BARE_CATEGORIES:
        return False
    if any(lowered.startswith(phrase) for phrase in _TOPIC_PHRASES):
        return False

    ends_in_category = lowered.endswith(_CATEGORY_PLURALS)
    if ends_in_category:
        # "four benchmark datasets", "several public benchmarks"
        if words[0].lower() in _QUANTIFIERS:
            return False
        # "reasoning benchmarks", "single-hop datasets" — durchgehend klein
        # geschrieben, also kein Eigenname.
        if name == name.lower():
            return False
    return True


def canonical_key(name: str) -> str:
    """Identity key of an entity — surface variants of one concept share it.

    ``Cross-Encoder``, ``cross encoder`` and ``Cross Encoders`` all yield
    ``cross encoder``; aliases map onto the canonical spelling first.
    """
    flat = _flatten(name)
    if not flat:
        return ""
    alias = _FLAT_ALIASES.get(flat)
    if alias:
        flat = _flatten(alias)
    words = [_singular(w) for w in flat.split(" ")]
    meaningful = [w for w in words if w not in _FILLER]
    return " ".join(meaningful or words)


_FLAT_ALIASES.update({_flatten(k): v for k, v in ALIASES.items()})
