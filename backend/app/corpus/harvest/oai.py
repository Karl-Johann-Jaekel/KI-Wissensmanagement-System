"""OAI-PMH-Client — Protokollschicht ohne Wissen über einzelne Quellen.

OAI-PMH ist das Standardprotokoll wissenschaftlicher Repositorien und liefert genau
das, was der bisherige Einzelabruf nicht kann: **Delta-Ernte über einen
Zeitstempel-Filter** (``from``/``until``) statt Suchanfragen. Zurück kommen Seiten
mit einem ``resumptionToken``; der Zeiger wird mitgeschrieben, damit ein Abbruch
nicht den ganzen Lauf kostet.

Zwei Eigenheiten des Protokolls, die man kennen muss:

* ``noRecordsMatch`` ist **kein Fehler**, sondern die leere Antwort.
* Ein ``resumptionToken`` darf **nicht** zusammen mit ``from``/``until``/``set``
  gesendet werden — er trägt diese Parameter bereits in sich.
"""

from __future__ import annotations

import time
import xml.etree.ElementTree as ET
from collections.abc import Callable, Iterator

import httpx

from app.corpus.harvest.base import (
    HarvestError,
    HarvestStats,
    RateLimiter,
    request_with_backoff,
)

OAI_NS = {"oai": "http://www.openarchives.org/OAI/2.0/"}

#: Leere Ergebnismenge — laut Spezifikation ein Fehlercode, fachlich ein Normalfall.
EMPTY_CODE = "noRecordsMatch"
#: Abgelaufener Blätter-Zeiger: der gespeicherte Zustand ist wertlos, neu beginnen.
STALE_TOKEN_CODE = "badResumptionToken"


class StaleResumptionToken(HarvestError):
    """Der gespeicherte ``resumptionToken`` ist abgelaufen."""


def _oai_error(root: ET.Element) -> tuple[str, str] | None:
    node = root.find("oai:error", OAI_NS)
    if node is None:
        return None
    return node.attrib.get("code", ""), (node.text or "").strip()


def iter_records(
    client: httpx.Client,
    base_url: str,
    *,
    metadata_prefix: str,
    since: str | None = None,
    until: str | None = None,
    set_spec: str | None = None,
    resume: str | None = None,
    limiter: RateLimiter | None = None,
    stats: HarvestStats | None = None,
    max_pages: int = 10_000,
    on_page: Callable[[str | None], None] | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> Iterator[ET.Element]:
    """``ListRecords`` seitenweise durchlaufen und einzelne ``<record>`` liefern.

    ``on_page`` bekommt nach jeder Seite den nächsten ``resumptionToken`` (bzw.
    ``None`` am Ende) — darüber schreibt der Aufrufer seinen Fortschritt fort.
    """
    token = resume
    for _ in range(max_pages):
        if token:
            params: dict[str, str] = {"verb": "ListRecords", "resumptionToken": token}
        else:
            params = {"verb": "ListRecords", "metadataPrefix": metadata_prefix}
            if since:
                params["from"] = since
            if until:
                params["until"] = until
            if set_spec:
                params["set"] = set_spec

        response = request_with_backoff(
            client, base_url, params=params, limiter=limiter, stats=stats, sleep=sleep
        )
        try:
            root = ET.fromstring(response.text)
        except ET.ParseError as exc:
            raise HarvestError(f"OAI-Antwort nicht lesbar: {exc}") from exc

        error = _oai_error(root)
        if error is not None:
            code, message = error
            if code == EMPTY_CODE:
                if on_page is not None:
                    on_page(None)
                return
            if code == STALE_TOKEN_CODE:
                raise StaleResumptionToken(message or code)
            raise HarvestError(f"OAI-Fehler {code}: {message}")

        listing = root.find("oai:ListRecords", OAI_NS)
        if listing is None:
            if on_page is not None:
                on_page(None)
            return
        yield from listing.findall("oai:record", OAI_NS)

        token_node = listing.find("oai:resumptionToken", OAI_NS)
        token = (token_node.text or "").strip() if token_node is not None else ""
        if on_page is not None:
            on_page(token or None)
        if not token:
            return

    raise HarvestError(f"mehr als {max_pages} Seiten — Abbruch als Reißleine")


def is_deleted(record: ET.Element) -> bool:
    """Gelöschte Datensätze tragen kein Metadatenfeld, nur einen Status im Header."""
    header = record.find("oai:header", OAI_NS)
    return header is not None and header.attrib.get("status") == "deleted"


def header_datestamp(record: ET.Element) -> str | None:
    node = record.find("oai:header/oai:datestamp", OAI_NS)
    return (node.text or "").strip() if node is not None and node.text else None


def header_identifier(record: ET.Element) -> str | None:
    node = record.find("oai:header/oai:identifier", OAI_NS)
    return (node.text or "").strip() if node is not None and node.text else None


def metadata_child(record: ET.Element) -> ET.Element | None:
    """Das quellenspezifische Element unterhalb von ``<metadata>``."""
    node = record.find("oai:metadata", OAI_NS)
    if node is None:
        return None
    return next(iter(node), None)


__all__ = [
    "EMPTY_CODE",
    "OAI_NS",
    "STALE_TOKEN_CODE",
    "StaleResumptionToken",
    "header_datestamp",
    "header_identifier",
    "is_deleted",
    "iter_records",
    "metadata_child",
]
