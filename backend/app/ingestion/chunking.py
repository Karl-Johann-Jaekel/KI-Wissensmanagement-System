"""Heading-aware Markdown chunking (PLAN §4/§7 Phase 3).

Split on Markdown headings into sections, then pack paragraphs into ~target-sized
chunks with a small overlap. Paragraphs (blank-line separated) are kept whole where
possible, so tables and formula blocks are not cut mid-structure. Overlong paragraphs
are hard-windowed. Pure functions — unit-tested without a DB or models.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

TARGET_CHARS = 1000
OVERLAP_CHARS = 150

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
_PARA_SPLIT_RE = re.compile(r"\n\s*\n")


@dataclass
class ChunkSpec:
    index: int
    content: str
    heading: str | None = None
    meta: dict = field(default_factory=dict)


def _split_by_heading(md: str) -> list[tuple[str | None, str]]:
    """Return [(heading_text | None, body)] sections in document order."""
    sections: list[tuple[str | None, list[str]]] = []
    current_heading: str | None = None
    current_body: list[str] = []

    def flush() -> None:
        if current_body or current_heading is not None:
            sections.append((current_heading, current_body[:]))

    for line in md.splitlines():
        m = _HEADING_RE.match(line.strip())
        if m:
            flush()
            current_heading = m.group(2).strip()
            current_body = []
        else:
            current_body.append(line)
    flush()
    return [(h, "\n".join(b).strip()) for h, b in sections]


def _hard_window(text: str, target: int, overlap: int) -> list[str]:
    windows: list[str] = []
    start = 0
    n = len(text)
    while start < n:
        end = min(start + target, n)
        windows.append(text[start:end].strip())
        if end >= n:
            break
        start = max(end - overlap, start + 1)
    return [w for w in windows if w]


def _pack_paragraphs(body: str, target: int, overlap: int) -> list[str]:
    if not body.strip():
        return []
    paragraphs = [p.strip() for p in _PARA_SPLIT_RE.split(body) if p.strip()]
    chunks: list[str] = []
    current = ""
    for para in paragraphs:
        if len(para) > target:
            if current:
                chunks.append(current)
                current = ""
            chunks.extend(_hard_window(para, target, overlap))
            continue
        if current and len(current) + len(para) + 2 > target:
            chunks.append(current)
            tail = current[-overlap:] if overlap else ""
            current = (tail + "\n\n" + para).strip() if tail else para
        else:
            current = (current + "\n\n" + para).strip() if current else para
    if current:
        chunks.append(current)
    return chunks


def chunk_markdown(
    md: str, *, target_chars: int = TARGET_CHARS, overlap_chars: int = OVERLAP_CHARS
) -> list[ChunkSpec]:
    specs: list[ChunkSpec] = []
    idx = 0
    for heading, body in _split_by_heading(md):
        for content in _pack_paragraphs(body, target_chars, overlap_chars):
            specs.append(ChunkSpec(index=idx, content=content, heading=heading))
            idx += 1
    return specs
