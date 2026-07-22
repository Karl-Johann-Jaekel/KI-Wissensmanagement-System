"""Unit tests for heading-aware Markdown chunking (no DB/models)."""

from __future__ import annotations

from app.ingestion.chunking import chunk_markdown


def test_splits_by_heading() -> None:
    md = "# Intro\nHello world.\n\n## Methods\nWe do things."
    specs = chunk_markdown(md)
    headings = [s.heading for s in specs]
    assert "Intro" in headings
    assert "Methods" in headings
    assert specs[0].index == 0
    assert all(specs[i].index == i for i in range(len(specs)))


def test_empty_markdown() -> None:
    assert chunk_markdown("   \n\n  ") == []


def test_long_section_is_windowed_with_overlap() -> None:
    para = " ".join(f"word{i}" for i in range(600))  # one long paragraph
    specs = chunk_markdown(f"# Big\n{para}", target_chars=300, overlap_chars=60)
    assert len(specs) > 1
    assert all(len(s.content) <= 320 for s in specs)  # ~target, small slack
    # consecutive windows overlap: tail of one appears at head of next
    a, b = specs[0].content, specs[1].content
    assert a[-20:] in b or any(tok in b for tok in a.split()[-3:])


def test_table_paragraph_stays_intact() -> None:
    table = "| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |"
    md = f"# Data\nBefore.\n\n{table}\n\nAfter."
    specs = chunk_markdown(md, target_chars=1000)
    joined = "\n".join(s.content for s in specs)
    assert "| a | b |" in joined
    assert "|---|---|" in joined  # separator row not split away


def test_paragraphs_packed_up_to_target() -> None:
    paras = "\n\n".join(["x" * 200 for _ in range(6)])
    specs = chunk_markdown(f"# S\n{paras}", target_chars=500, overlap_chars=50)
    # 6*200 chars should pack into a few chunks, not 6
    assert 1 < len(specs) < 6
