"""Delta-Fetch: Suchausdruck muss thematisch binden (Regression zu 2026-08-03).

Ohne quotierte Phrase und Kategorie-Klammer lieferte `sortBy=submittedDate` die
neuesten arXiv-Einreichungen quer durch alle Disziplinen — 20 von 40 geholten
Papers hatten keinerlei cs.-Kategorie.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import httpx

from app.corpus.arxiv import CORPUS_CATEGORIES, build_search_query, delta_fetch

ENTRY_TEMPLATE = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2607.00001v1</id>
    <title>A Relevant RAG Paper</title>
    <published>2026-07-15T00:00:00Z</published>
    <summary>Abstract text.</summary>
    <author><name>Doe</name></author>
    <category term="cs.CL"/>
    <link title="pdf" href="http://arxiv.org/pdf/2607.00001v1" type="application/pdf"/>
  </entry>
</feed>
"""


def test_query_quotes_phrase_and_restricts_categories() -> None:
    q = build_search_query("retrieval augmented generation")
    assert 'all:"retrieval augmented generation"' in q
    for cat in CORPUS_CATEGORIES:
        assert f"cat:{cat}" in q
    # Die Phrase darf nicht unquotiert ans Feld gebunden werden.
    assert "all:retrieval augmented" not in q


def test_delta_fetch_sends_scoped_query(tmp_path: Path) -> None:
    seen: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        if "query" in request.url.path:
            seen.append(request.url.params.get("search_query", ""))
            return httpx.Response(200, text=ENTRY_TEMPLATE)
        return httpx.Response(200, content=b"%PDF-1.4 fake")

    client = httpx.Client(transport=httpx.MockTransport(handle))
    fetched = delta_fetch(
        ["retrieval augmented generation"],
        date(2026, 1, 1),
        out=tmp_path,
        cap=1,
        client=client,
    )

    assert fetched == ["2607.00001"]
    assert seen and seen[0] == build_search_query("retrieval augmented generation")
    assert (tmp_path / "2607.00001.pdf").exists()
    assert (tmp_path / "2607.00001.json").exists()
