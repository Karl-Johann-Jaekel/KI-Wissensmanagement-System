"""Cross-encoder reranking with bge-reranker-v2-m3 (PLAN §7 Phase 4).

Behind ``RERANK_ENABLED`` (default off — CPU-slow on the VPS). transformers/torch are
already present (Docling), so no extra dependency; the model is lazy-loaded and cached
on first use. Multilingual, so it also reranks German-query / English-passage pairs.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from app.core.config import get_settings


@lru_cache(maxsize=1)
def _load(model_name: str) -> tuple[Any, Any, Any]:
    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModelForSequenceClassification.from_pretrained(model_name)
    model.eval()
    return tokenizer, model, torch


def rerank_scores(
    query: str,
    passages: list[str],
    *,
    model_name: str | None = None,
    max_length: int = 512,
) -> list[float]:
    """Relevance score per passage (higher = more relevant). Same order as input."""
    if not passages:
        return []
    model_name = model_name or get_settings().rerank_model
    tokenizer, model, torch = _load(model_name)
    pairs = [[query, p] for p in passages]
    with torch.no_grad():
        inputs = tokenizer(
            pairs, padding=True, truncation=True, max_length=max_length, return_tensors="pt"
        )
        logits = model(**inputs).logits.view(-1).float()
    return logits.tolist()
