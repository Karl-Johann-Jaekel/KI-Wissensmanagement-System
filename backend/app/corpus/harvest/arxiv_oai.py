"""arXiv über OAI-PMH ernten (PLAN §7 Phase 11.3).

Ablösung des bisherigen Einzelabrufs (``app.corpus.arxiv``, Query-API mit
``sortBy=submittedDate``): Die Query-API kennt keinen Änderungszeitstempel, liefert
also entweder Dubletten oder Lücken. OAI-PMH filtert über ``from``/``until`` auf das
**Änderungsdatum** — der Delta-Lauf holt damit auch überarbeitete Fassungen, nicht
nur Neueinreichungen.

Endpunkt geprüft am 18.08.2026: ``https://oaipmh.arxiv.org/oai``. Der historische
``export.arxiv.org/oai2`` antwortet nicht mehr.

Metadatenformat ``arXiv`` (nicht ``oai_dc``): Es trennt Vor- und Nachnamen, führt
Kategorien einzeln und nennt DOI und Lizenz — ``oai_dc`` presst alles in
Dublin-Core-Felder und verliert die Struktur.

    python -m app.corpus.harvest --source arxiv --since 2026-08-01
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from datetime import UTC, date, datetime

import defusedxml.ElementTree as ET
import httpx

from app.corpus.harvest.base import (
    USER_AGENT,
    Deduper,
    HarvestRecord,
    HarvestStats,
    RateLimiter,
    Sink,
    inverted_index,
    strip_emails,
    utc_now,
)
from app.corpus.harvest.oai import (
    header_datestamp,
    is_deleted,
    iter_records,
    metadata_child,
)

SOURCE = "arxiv"
BASE_URL = "https://oaipmh.arxiv.org/oai"
METADATA_PREFIX = "arXiv"
ARXIV_NS = {"a": "http://arxiv.org/OAI/arXiv/"}
ABS_URL = "https://arxiv.org/abs/{id}"

#: Fachgebiete des Korpus (PLAN §4) als OAI-Sets. OAI erlaubt genau **ein** Set je
#: Anfrage — die Gebiete werden deshalb nacheinander geerntet.
CORPUS_SETS = ("cs:cs:AI", "cs:cs:CL", "cs:cs:IR", "cs:cs:LG")

#: arXiv drosselt OAI-Abfragen hart; der Abstand ist Höflichkeit, kein Feintuning.
POLITE_INTERVAL_S = 5.0


def _text(parent: ET.Element, path: str) -> str:
    node = parent.find(path, ARXIV_NS)
    return (node.text or "").strip() if node is not None and node.text else ""


def _authors(meta: ET.Element) -> list[str]:
    """Autorennamen als „Vorname Nachname". Kontaktdaten werden nicht übernommen."""
    out: list[str] = []
    for author in meta.findall("a:authors/a:author", ARXIV_NS):
        name = " ".join(
            part for part in (_text(author, "a:forenames"), _text(author, "a:keyname")) if part
        )
        cleaned = strip_emails(name)
        if cleaned:
            out.append(cleaned)
    return out


def parse_record(record: ET.Element, *, fetched_at: str, fetched_by: str) -> HarvestRecord | None:
    """Ein OAI-``<record>`` → ``HarvestRecord``; ``None`` bei gelöscht/unbrauchbar."""
    if is_deleted(record):
        return None
    meta = metadata_child(record)
    if meta is None:
        return None
    arxiv_id = _text(meta, "a:id")
    title = " ".join(_text(meta, "a:title").split())
    if not arxiv_id or not title:
        return None

    return HarvestRecord(
        source=SOURCE,
        source_id=arxiv_id,
        title=title,
        source_url=ABS_URL.format(id=arxiv_id),
        fetched_at=fetched_at,
        fetched_by=fetched_by,
        doi=_text(meta, "a:doi") or None,
        authors=_authors(meta),
        published=_text(meta, "a:created") or None,
        updated=_text(meta, "a:updated") or header_datestamp(record),
        categories=_text(meta, "a:categories").split(),
        # Abstract nur als invertierter Index — die arXiv-Standardlizenz erlaubt
        # keine Weitergabe des Volltexts.
        abstract_index=inverted_index(_text(meta, "a:abstract")),
        extra={"license": _text(meta, "a:license") or None},
    )


def harvest(
    *,
    since: date | str,
    until: date | str | None = None,
    sets: tuple[str, ...] = CORPUS_SETS,
    sink: Sink,
    client: httpx.Client | None = None,
    deduper: Deduper | None = None,
    stats: HarvestStats | None = None,
    limiter: RateLimiter | None = None,
    cap: int | None = None,
    resume: str | None = None,
    on_page: Callable[[str | None], None] | None = None,
    fetched_by: str = USER_AGENT,
) -> HarvestStats:
    """Delta-Ernte über das Änderungsdatum. Gibt die Laufstatistik zurück."""
    stats = stats or HarvestStats()
    deduper = deduper if deduper is not None else Deduper()
    limiter = limiter or RateLimiter(POLITE_INTERVAL_S)
    own = client is None
    http = client or httpx.Client(
        headers={"User-Agent": USER_AGENT}, timeout=120.0, follow_redirects=True
    )
    fetched_at = utc_now()

    try:
        for set_spec in sets:
            if cap is not None and stats.records >= cap:
                break
            pages = iter_records(
                http,
                BASE_URL,
                metadata_prefix=METADATA_PREFIX,
                since=_iso(since),
                until=_iso(until),
                set_spec=set_spec,
                resume=resume,
                limiter=limiter,
                stats=stats,
                on_page=on_page,
            )
            resume = None  # Ein gespeicherter Zeiger gilt nur fürs erste Set.
            for element in pages:
                if cap is not None and stats.records >= cap:
                    break
                _emit(element, sink, deduper, stats, fetched_at, fetched_by)
    finally:
        if own:
            http.close()
    return stats


def _emit(
    element: ET.Element,
    sink: Sink,
    deduper: Deduper,
    stats: HarvestStats,
    fetched_at: str,
    fetched_by: str,
) -> None:
    """Einen Datensatz verarbeiten. Ein kaputter darf den Lauf nicht abbrechen."""
    try:
        record = parse_record(element, fetched_at=fetched_at, fetched_by=fetched_by)
    except (ET.ParseError, ValueError, TypeError):
        stats.failed += 1
        return
    if record is None:
        stats.skipped += 1
        return
    if deduper.seen(record):
        stats.duplicates += 1
        return
    deduper.add(record)
    sink(record)
    stats.records += 1


def _iso(value: date | str | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.astimezone(UTC).date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def iter_parsed(
    client: httpx.Client, **kwargs: object
) -> Iterator[HarvestRecord]:  # pragma: no cover - Bequemlichkeit für Notebooks
    records: list[HarvestRecord] = []
    harvest(sink=records.append, client=client, **kwargs)  # type: ignore[arg-type]
    yield from records


__all__ = ["BASE_URL", "CORPUS_SETS", "SOURCE", "harvest", "parse_record"]
