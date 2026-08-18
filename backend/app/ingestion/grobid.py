"""GROBID: PDF → TEI-XML → Struktur (PLAN §7 Phase 11.4, ADR-0019).

Docling liefert Markdown und damit Text plus Überschriften — genug für Chunks, aber
das Literaturverzeichnis bleibt Fließtext. GROBID zerlegt genau diesen Teil: Es gibt
Referenzen als Einzelfelder zurück (Titel, Autor:innen, Jahr, DOI). Damit wird der
Zitationsgraph erst möglich, den PLAN §1 bisher als Nicht-Ziel führte.

Der Dienst läuft im Compose-Profil ``grobid`` und ist optional; ohne ihn bleibt
Docling der Standardweg (ADR-0011).

    docker compose --profile grobid up -d
    python -m app.ingestion.grobid data/corpus/2005.11401.pdf --markdown

**Keine Kontaktdaten.** GROBID extrahiert ``<email>`` je Autor:in — dieses Feld
wird bewusst nicht übernommen (PLAN §7 Phase 11).
"""

from __future__ import annotations

import argparse
import json
import time
import xml.etree.ElementTree as ET
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from pathlib import Path

import httpx

from app.core.config import get_settings

# Dieselbe Bereinigung wie im Harvester — eine Quelle für die Regel, nicht zwei.
from app.corpus.harvest.base import strip_emails

TEI_NS = {"t": "http://www.tei-c.org/ns/1.0"}

FULLTEXT_ENDPOINT = "/api/processFulltextDocument"
ALIVE_ENDPOINT = "/api/isalive"

#: GROBID antwortet mit 503, wenn alle Worker belegt sind — das ist Rückstau,
#: kein Fehler. Erneut versuchen ist hier die richtige Antwort.
BUSY_STATUS = 503


class GrobidError(RuntimeError):
    pass


# ------------------------------------------------------------------ Datenmodell


@dataclass
class Section:
    heading: str
    paragraphs: list[str] = field(default_factory=list)

    @property
    def text(self) -> str:
        return "\n\n".join(self.paragraphs)


@dataclass
class Reference:
    """Eine geparste Literaturangabe. Rohtext bleibt für den Zweifelsfall erhalten."""

    title: str | None = None
    authors: list[str] = field(default_factory=list)
    year: str | None = None
    doi: str | None = None
    journal: str | None = None


@dataclass
class GrobidDocument:
    title: str | None = None
    authors: list[str] = field(default_factory=list)
    doi: str | None = None
    published: str | None = None
    abstract: str | None = None
    sections: list[Section] = field(default_factory=list)
    references: list[Reference] = field(default_factory=list)

    def to_json(self) -> dict:
        return asdict(self)


# ------------------------------------------------------------------ TEI lesen


def _text(node: ET.Element | None) -> str:
    """Gesamter Textinhalt eines Knotens, Leerraum normalisiert."""
    if node is None:
        return ""
    return " ".join("".join(node.itertext()).split())


def _person_name(person: ET.Element) -> str:
    """``<persName>`` → „Vorname Nachname"; ``<email>`` wird nie gelesen."""
    parts = [
        _text(person.find("t:forename[@type='first']", TEI_NS)),
        _text(person.find("t:forename[@type='middle']", TEI_NS)),
        _text(person.find("t:surname", TEI_NS)),
    ]
    return strip_emails(" ".join(p for p in parts if p))


def _authors(scope: ET.Element) -> list[str]:
    out: list[str] = []
    for author in scope.findall(".//t:author", TEI_NS):
        person = author.find("t:persName", TEI_NS)
        name = _person_name(person) if person is not None else ""
        if name and name not in out:
            out.append(name)
    return out


def _idno(scope: ET.Element, kind: str) -> str | None:
    node = scope.find(f".//t:idno[@type='{kind}']", TEI_NS)
    return _text(node) or None


def _parse_reference(entry: ET.Element) -> Reference | None:
    analytic = entry.find("t:analytic", TEI_NS)
    monogr = entry.find("t:monogr", TEI_NS)
    title = _text(entry.find(".//t:title[@type='main']", TEI_NS)) or _text(
        entry.find(".//t:title", TEI_NS)
    )
    date = entry.find(".//t:date[@type='published']", TEI_NS)
    year = (date.attrib.get("when") if date is not None else None) or _text(date)
    journal = _text(monogr.find("t:title[@level='j']", TEI_NS)) if monogr is not None else ""
    scope = analytic if analytic is not None else entry
    reference = Reference(
        title=title or None,
        authors=_authors(scope),
        year=(year or "")[:4] or None,
        doi=_idno(entry, "DOI"),
        journal=journal or None,
    )
    # Eine Angabe ohne Titel und ohne DOI trägt nichts zum Zitationsgraphen bei.
    return reference if (reference.title or reference.doi) else None


def parse_tei(xml: str) -> GrobidDocument:
    """TEI-XML → strukturiertes Dokument (Titel, Autor:innen, Sektionen, Referenzen)."""
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as exc:
        raise GrobidError(f"TEI nicht lesbar: {exc}") from exc

    header = root.find("t:teiHeader", TEI_NS)
    document = GrobidDocument()
    if header is not None:
        document.title = _text(header.find(".//t:titleStmt/t:title", TEI_NS)) or None
        source = header.find(".//t:sourceDesc", TEI_NS)
        if source is not None:
            document.authors = _authors(source)
            document.doi = _idno(source, "DOI")
            date = source.find(".//t:date[@type='published']", TEI_NS)
            if date is not None:
                document.published = date.attrib.get("when") or _text(date) or None
        document.abstract = _text(header.find(".//t:abstract", TEI_NS)) or None

    for div in root.findall(".//t:text/t:body/t:div", TEI_NS):
        paragraphs = [p for p in (_text(node) for node in div.findall("t:p", TEI_NS)) if p]
        heading = _text(div.find("t:head", TEI_NS))
        if heading or paragraphs:
            document.sections.append(Section(heading=heading, paragraphs=paragraphs))

    for entry in root.findall(".//t:back//t:listBibl/t:biblStruct", TEI_NS):
        reference = _parse_reference(entry)
        if reference is not None:
            document.references.append(reference)

    return document


def to_markdown(document: GrobidDocument) -> str:
    """Struktur → Markdown für den überschriften-bewussten Chunker (PLAN §4).

    Referenzen bleiben draußen: Sie sind Metadaten für den Graphen, als Chunk
    wären sie nur Rauschen im Retrieval.
    """
    lines: list[str] = []
    if document.title:
        lines += [f"# {document.title}", ""]
    if document.abstract:
        lines += ["## Abstract", "", document.abstract, ""]
    for section in document.sections:
        if section.heading:
            lines += [f"## {section.heading}", ""]
        for paragraph in section.paragraphs:
            lines += [paragraph, ""]
    return "\n".join(lines).strip() + "\n"


# ------------------------------------------------------------------ Dienst


def is_alive(*, base_url: str | None = None, client: httpx.Client | None = None) -> bool:
    url = (base_url or get_settings().grobid_url).rstrip("/") + ALIVE_ENDPOINT
    own = client is None
    http = client or httpx.Client(timeout=10.0)
    try:
        return http.get(url).status_code == 200
    except httpx.HTTPError:
        return False
    finally:
        if own:
            http.close()


def process_pdf(
    pdf_path: Path,
    *,
    base_url: str | None = None,
    client: httpx.Client | None = None,
    consolidate_citations: int = 0,
    retries: int = 3,
    sleep: Callable[[float], None] = time.sleep,
) -> str:
    """Ein PDF an GROBID geben und das TEI-XML zurückbekommen.

    ``consolidate_citations=1`` gleicht Referenzen gegen Crossref ab — deutlich
    langsamer und ein externer Dienst mehr, deshalb standardmäßig aus.
    """
    settings = get_settings()
    url = (base_url or settings.grobid_url).rstrip("/") + FULLTEXT_ENDPOINT
    own = client is None
    http = client or httpx.Client(timeout=settings.grobid_timeout_s)
    data = {
        "consolidateHeader": "1",
        "consolidateCitations": str(consolidate_citations),
        # Rohtext der Referenz mitliefern — hilft beim Nachvollziehen von Fehlparses.
        "includeRawCitations": "1",
    }
    try:
        raw = pdf_path.read_bytes()
        last: Exception | None = None
        for attempt in range(retries):
            try:
                response = http.post(
                    url, files={"input": (pdf_path.name, raw, "application/pdf")}, data=data
                )
            except httpx.HTTPError as exc:
                last = exc
            else:
                # 503 heißt „alle Worker belegt", nicht „kaputt".
                if response.status_code != BUSY_STATUS:
                    response.raise_for_status()
                    return response.text
                last = GrobidError(f"GROBID ausgelastet (HTTP {response.status_code})")
            if attempt < retries - 1:
                sleep(2.0 * (attempt + 1))
        raise GrobidError(f"{pdf_path.name}: GROBID nach {retries} Versuchen aufgegeben: {last}")
    finally:
        if own:
            http.close()


def process_to_document(pdf_path: Path, **kwargs: object) -> GrobidDocument:
    return parse_tei(process_pdf(pdf_path, **kwargs))  # type: ignore[arg-type]


def markdown_from_pdf(pdf_path: Path) -> str:
    """PDF → Markdown, passend zur ``ToMarkdown``-Signatur der Ingest-Pipeline.

    Damit lässt sich GROBID anstelle von Docling einhängen, ohne die Pipeline zu
    ändern::

        ingest_file(session, pdf, to_md=markdown_from_pdf)
    """
    return to_markdown(process_to_document(pdf_path))


# ------------------------------------------------------------------ CLI


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="PDF über GROBID strukturieren.")
    parser.add_argument("pdf", help="Pfad zu einer PDF-Datei")
    parser.add_argument("--url", default=None, help="GROBID-Basis-URL (sonst aus .env)")
    parser.add_argument("--markdown", action="store_true", help="Markdown statt Zusammenfassung")
    parser.add_argument("--json", action="store_true", help="komplette Struktur als JSON")
    parser.add_argument("--tei", action="store_true", help="rohes TEI-XML")
    args = parser.parse_args(argv)

    path = Path(args.pdf)
    if not path.exists():
        parser.error(f"nicht gefunden: {path}")
    if not is_alive(base_url=args.url):
        parser.error(
            "GROBID nicht erreichbar — Dienst starten: docker compose --profile grobid up -d"
        )

    xml = process_pdf(path, base_url=args.url)
    if args.tei:
        print(xml)
        return 0
    document = parse_tei(xml)
    if args.json:
        print(json.dumps(document.to_json(), indent=2, ensure_ascii=False))
    elif args.markdown:
        print(to_markdown(document))
    else:
        print(f"Titel      : {document.title}")
        print(f"Autor:innen: {', '.join(document.authors) or '—'}")
        print(f"DOI        : {document.doi or '—'}")
        print(f"Sektionen  : {len(document.sections)}")
        for section in document.sections[:12]:
            print(f"  - {section.heading or '(ohne Überschrift)'} ({len(section.paragraphs)} Abs.)")
        print(f"Referenzen : {len(document.references)}")
        for reference in document.references[:5]:
            print(f"  - {reference.year or '????'}  {(reference.title or '')[:70]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
