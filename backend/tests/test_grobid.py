"""GROBID-Anbindung (PLAN §7 Phase 11.4, ADR-0019).

Kein Test braucht den Dienst: Der Parser läuft gegen ein handgeschriebenes TEI, der
Client gegen ``httpx.MockTransport``. Das TEI-Fixture ist bewusst selbst getextet —
die TEI-Ausgabe eines echten Papers enthält dessen Volltext und dürfte nicht ins
Repo (PLAN §2.5).
"""

from __future__ import annotations

from pathlib import Path

import httpx
import pytest

from app.ingestion.grobid import (
    GrobidError,
    is_alive,
    parse_tei,
    process_pdf,
    to_markdown,
)

TEI = """<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader>
    <fileDesc>
      <titleStmt>
        <title level="a" type="main">Ein Verfahren zur Belegprüfung</title>
      </titleStmt>
      <sourceDesc>
        <biblStruct>
          <analytic>
            <author>
              <persName>
                <forename type="first">Ada</forename>
                <surname>Lovelace</surname>
              </persName>
              <email>ada@example.org</email>
              <affiliation><orgName>Beispiel-Institut</orgName></affiliation>
            </author>
            <author>
              <persName>
                <forename type="first">Alan</forename>
                <forename type="middle">M</forename>
                <surname>Turing</surname>
              </persName>
            </author>
            <idno type="DOI">10.1145/beispiel</idno>
          </analytic>
          <monogr>
            <imprint><date type="published" when="2026-08-18" /></imprint>
          </monogr>
        </biblStruct>
      </sourceDesc>
    </fileDesc>
    <profileDesc>
      <abstract><div><p>Wir zeigen ein Verfahren.</p></div></abstract>
    </profileDesc>
  </teiHeader>
  <text>
    <body>
      <div>
        <head n="1">Einleitung</head>
        <p>Erster    Absatz.</p>
        <p>Zweiter Absatz.</p>
      </div>
      <div>
        <head n="2">Methode</head>
        <p>Beschreibung der Methode.</p>
      </div>
      <div>
        <p>Ein Absatz ohne Überschrift.</p>
      </div>
    </body>
    <back>
      <div type="references">
        <listBibl>
          <biblStruct xml:id="b0">
            <analytic>
              <title level="a" type="main">Aufmerksamkeit genügt</title>
              <author>
                <persName><forename type="first">Noam</forename>
                <surname>Shazeer</surname></persName>
              </author>
              <idno type="DOI">10.5555/aufmerksamkeit</idno>
            </analytic>
            <monogr>
              <title level="j">Konferenzband</title>
              <imprint><date type="published" when="2017-06-12" /></imprint>
            </monogr>
          </biblStruct>
          <biblStruct xml:id="b1">
            <monogr>
              <title level="m">Ein Buch ohne Autor</title>
              <imprint><date type="published" when="1999" /></imprint>
            </monogr>
          </biblStruct>
          <biblStruct xml:id="b2">
            <monogr><imprint /></monogr>
          </biblStruct>
        </listBibl>
      </div>
    </back>
  </text>
</TEI>
"""


# --------------------------------------------------------------- Kopfdaten


def test_header_fields_are_extracted() -> None:
    document = parse_tei(TEI)
    assert document.title == "Ein Verfahren zur Belegprüfung"
    assert document.doi == "10.1145/beispiel"
    assert document.published == "2026-08-18"
    assert document.abstract == "Wir zeigen ein Verfahren."


def test_authors_carry_no_contact_data() -> None:
    """GROBID liefert ``<email>`` je Autor:in — das Feld wird nie übernommen."""
    document = parse_tei(TEI)
    assert document.authors == ["Ada Lovelace", "Alan M Turing"]
    assert not any("@" in name for name in document.authors)


# --------------------------------------------------------------- Struktur


def test_sections_keep_headings_and_paragraphs() -> None:
    document = parse_tei(TEI)
    assert [s.heading for s in document.sections] == ["Einleitung", "Methode", ""]
    assert document.sections[0].paragraphs == ["Erster Absatz.", "Zweiter Absatz."]
    # Ein Abschnitt ohne Überschrift geht nicht verloren.
    assert document.sections[2].paragraphs == ["Ein Absatz ohne Überschrift."]


def test_references_are_parsed_into_fields() -> None:
    """Das ist der Grund für GROBID: Referenzen als Felder, nicht als Fließtext."""
    document = parse_tei(TEI)
    assert len(document.references) == 2  # der Eintrag ohne Titel und DOI fällt weg
    first = document.references[0]
    assert first.title == "Aufmerksamkeit genügt"
    assert first.authors == ["Noam Shazeer"]
    assert first.year == "2017"
    assert first.doi == "10.5555/aufmerksamkeit"
    assert first.journal == "Konferenzband"
    assert document.references[1].title == "Ein Buch ohne Autor"
    assert document.references[1].authors == []


def test_markdown_feeds_the_heading_aware_chunker() -> None:
    markdown = to_markdown(parse_tei(TEI))
    assert markdown.startswith("# Ein Verfahren zur Belegprüfung")
    assert "## Einleitung" in markdown
    assert "## Methode" in markdown
    # Referenzen gehören in den Graphen, nicht in die Chunks.
    assert "Aufmerksamkeit genügt" not in markdown


def test_broken_tei_fails_loudly() -> None:
    with pytest.raises(GrobidError, match="TEI nicht lesbar"):
        parse_tei("<TEI><unclosed>")


def test_empty_tei_yields_an_empty_document() -> None:
    document = parse_tei('<TEI xmlns="http://www.tei-c.org/ns/1.0"></TEI>')
    assert document.title is None
    assert document.sections == []
    assert document.references == []


# --------------------------------------------------------------- Dienst


def test_process_pdf_posts_the_file_and_returns_tei(tmp_path: Path) -> None:
    pdf = tmp_path / "paper.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    seen: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, text=TEI)

    client = httpx.Client(transport=httpx.MockTransport(handle))
    xml = process_pdf(pdf, base_url="http://grobid:8070", client=client)

    assert parse_tei(xml).title == "Ein Verfahren zur Belegprüfung"
    assert seen[0].url.path == "/api/processFulltextDocument"
    body = seen[0].content
    assert b"paper.pdf" in body
    assert b"includeRawCitations" in body


def test_process_pdf_retries_while_grobid_is_busy(tmp_path: Path) -> None:
    """503 heißt „alle Worker belegt" — Rückstau, kein Defekt."""
    pdf = tmp_path / "paper.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    calls: list[int] = []
    slept: list[float] = []

    def handle(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(503 if len(calls) < 3 else 200, text=TEI)

    client = httpx.Client(transport=httpx.MockTransport(handle))
    process_pdf(pdf, base_url="http://x", client=client, sleep=slept.append)

    assert len(calls) == 3
    assert slept == [2.0, 4.0]


def test_process_pdf_gives_up_with_a_clear_error(tmp_path: Path) -> None:
    pdf = tmp_path / "paper.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    client = httpx.Client(transport=httpx.MockTransport(lambda _r: httpx.Response(503)))
    with pytest.raises(GrobidError, match="nach 2 Versuchen"):
        process_pdf(pdf, base_url="http://x", client=client, retries=2, sleep=lambda _s: None)


def test_is_alive_reports_an_unreachable_service_as_false() -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no service", request=request)

    client = httpx.Client(transport=httpx.MockTransport(refuse))
    assert is_alive(base_url="http://grobid:8070", client=client) is False

    ok = httpx.Client(transport=httpx.MockTransport(lambda _r: httpx.Response(200, text="true")))
    assert is_alive(base_url="http://grobid:8070", client=ok) is True


def test_markdown_from_pdf_matches_the_pipeline_seam(tmp_path: Path, monkeypatch) -> None:
    """Die Pipeline erwartet ``Path -> str``; GROBID muss sich so einhängen lassen."""
    from app.ingestion import grobid as module
    from app.ingestion.pipeline import ToMarkdown

    pdf = tmp_path / "paper.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    monkeypatch.setattr(module, "process_pdf", lambda path, **_kw: TEI)

    to_md: ToMarkdown = module.markdown_from_pdf
    assert to_md(pdf).startswith("# Ein Verfahren zur Belegprüfung")
