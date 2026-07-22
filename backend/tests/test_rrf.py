"""Unit tests for Reciprocal Rank Fusion."""

from __future__ import annotations

from app.retrieval.rrf import reciprocal_rank_fusion


def test_empty() -> None:
    assert reciprocal_rank_fusion([]) == []
    assert reciprocal_rank_fusion([[], []]) == []


def test_item_in_both_rankings_scores_highest() -> None:
    vec = ["a", "b", "c"]
    kw = ["b", "d", "a"]
    fused = reciprocal_rank_fusion([vec, kw])
    ids = [i for i, _ in fused]
    # 'a' (rank1 + rank3) and 'b' (rank2 + rank1) appear twice -> lead
    assert set(ids[:2]) == {"a", "b"}
    assert ids[0] in {"a", "b"}


def test_scores_follow_formula() -> None:
    fused = dict(reciprocal_rank_fusion([["x", "y"]], k=60))
    assert abs(fused["x"] - 1 / 61) < 1e-9
    assert abs(fused["y"] - 1 / 62) < 1e-9
