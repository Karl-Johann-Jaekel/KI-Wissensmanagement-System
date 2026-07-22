"""Reciprocal Rank Fusion (PLAN §7 Phase 4).

Combine several ranked id-lists into one, robust to differing score scales:
    score(d) = sum over rankings of 1 / (k + rank(d))   (rank is 1-based)
"""

from __future__ import annotations

RRF_K = 60


def reciprocal_rank_fusion(rankings: list[list[str]], *, k: int = RRF_K) -> list[tuple[str, float]]:
    """Fuse ranked id-lists. Returns [(id, score)] sorted best-first."""
    scores: dict[str, float] = {}
    for ranking in rankings:
        for rank, item in enumerate(ranking, start=1):
            scores[item] = scores.get(item, 0.0) + 1.0 / (k + rank)
    return sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
