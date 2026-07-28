"""Concept/entity normalization (PLAN §7 Phase 8, §11 "Entity-Wildwuchs").

Maps common surface forms to a canonical name so "RAG" and "Retrieval-Augmented
Generation" become one node. Unknown entities are only whitespace-normalised (case
preserved — acronyms like BERT must survive).
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


def normalize_entity(name: str) -> str:
    """Canonical form for an entity name. Known aliases collapse; unknowns keep case."""
    cleaned = _WS.sub(" ", name.strip().strip(".,;:")).strip()
    if not cleaned:
        return ""
    return ALIASES.get(cleaned.lower(), cleaned)
