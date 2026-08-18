"""Gemeinsames Gerüst der Quellen-Harvester (PLAN §7 Phase 11.3).

Jede Quelle bringt ihr eigenes Protokoll mit (OAI-PMH, REST), aber dieselben vier
Probleme: höflich bleiben, Ausfälle überstehen, Dubletten erkennen und beim nächsten
Lauf dort weitermachen, wo der letzte aufgehört hat. Das steht hier einmal.

Zwei Leitplanken sind in den Datentypen verdrahtet, nicht in der Aufrufkonvention —
was hier nicht existiert, kann später niemand versehentlich speichern:

* **Kein Abstract-Rohtext.** ``HarvestRecord`` trägt nur einen invertierten Index
  (Token → Positionen). Für arXiv, OpenReview und Semantic Scholar erlaubt die
  Lizenz keine Volltext-Weitergabe; CC-lizenzierte Quellen laufen über die
  bestehende Ingest-Pipeline, nicht über den Harvester.
* **Keine E-Mail-Adressen.** Autorenfelder werden beim Parsen bereinigt.
"""

from __future__ import annotations

import json
import re
import time
from collections.abc import Callable, Iterable
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

USER_AGENT = "ki-wissensmanagement-system/0.1 (harvester; contact via repo)"

#: Statuscodes, bei denen ein erneuter Versuch sinnvoll ist.
RETRY_STATUS = frozenset({429, 500, 502, 503, 504})

_EMAIL = re.compile(r"[^\s<>()\[\]]+@[^\s<>()\[\]]+")
_WS = re.compile(r"\s+")
_NON_WORD = re.compile(r"[^\w\s]", re.UNICODE)
_TOKEN = re.compile(r"\w+", re.UNICODE)
_DOI_PREFIX = re.compile(r"^(https?://(dx\.)?doi\.org/|doi:)", re.IGNORECASE)


class HarvestError(RuntimeError):
    """Der Lauf kann nicht fortgesetzt werden (Protokollfehler, Aufgabe nach Retries)."""


# ------------------------------------------------------------------ Normalisierung


def strip_emails(value: str) -> str:
    """E-Mail-Adressen entfernen. Sie werden grundsätzlich nicht geerntet."""
    return _WS.sub(" ", _EMAIL.sub("", value)).strip(" ,;")


def normalize_doi(value: str | None) -> str | None:
    """``https://doi.org/10.1/X`` → ``10.1/x``; leere Angaben werden ``None``."""
    if not value:
        return None
    cleaned = _DOI_PREFIX.sub("", str(value).strip()).strip()
    return cleaned.lower() or None


def title_key(title: str | None) -> str:
    """Vergleichsschlüssel eines Titels: klein, ohne Satzzeichen, ohne Mehrfach-Leerzeichen.

    Zweiter Dedupe-Pfad neben der DOI — Preprints tragen oft gar keine, und
    dieselbe Arbeit erscheint auf arXiv und OpenReview mit identischem Titel.
    """
    flat = _NON_WORD.sub(" ", (title or "").lower())
    return _WS.sub(" ", flat).strip()


def inverted_index(text: str | None) -> dict[str, list[int]]:
    """Text → ``{token: [Positionen]}``.

    Das ist die einzige Form, in der Abstracts aus lizenzrechtlich engen Quellen in
    den Bestand dürfen (PLAN §7 Phase 11). Es ist bewusst **keine** Anonymisierung:
    Der Wortlaut ließe sich rekonstruieren. Es ist die Form, in der OpenAlex
    Abstracts verteilt, und sie reicht für Suche und Termstatistik.
    """
    if not text:
        return {}
    index: dict[str, list[int]] = {}
    for position, match in enumerate(_TOKEN.finditer(text)):
        index.setdefault(match.group(0).lower(), []).append(position)
    return index


# ------------------------------------------------------------------ Datensatz


@dataclass
class HarvestRecord:
    """Ein geernteter Datensatz, quellenunabhängig normalisiert."""

    source: str
    source_id: str
    title: str
    source_url: str
    fetched_at: str
    fetched_by: str
    doi: str | None = None
    #: Reine Namen. Affiliationen und Kontaktdaten werden nicht übernommen.
    authors: list[str] = field(default_factory=list)
    published: str | None = None
    updated: str | None = None
    categories: list[str] = field(default_factory=list)
    #: Abstract ausschließlich als invertierter Index — nie als Rohtext.
    abstract_index: dict[str, list[int]] = field(default_factory=dict)
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def title_key(self) -> str:
        return title_key(self.title)

    def to_json(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class HarvestStats:
    requests: int = 0
    retries: int = 0
    records: int = 0
    duplicates: int = 0
    skipped: int = 0
    failed: int = 0

    def as_dict(self) -> dict[str, int]:
        return asdict(self)


# ------------------------------------------------------------------ Höflichkeit


class RateLimiter:
    """Mindestabstand zwischen zwei Anfragen an dieselbe Quelle.

    Uhr und Schlaf sind injizierbar, damit Tests die Taktung prüfen können, ohne
    tatsächlich zu warten.
    """

    def __init__(
        self,
        min_interval: float,
        *,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.min_interval = min_interval
        self._clock = clock
        self._sleep = sleep
        self._last: float | None = None

    def wait(self) -> None:
        now = self._clock()
        if self._last is not None:
            remaining = self.min_interval - (now - self._last)
            if remaining > 0:
                self._sleep(remaining)
                now = self._clock()
        self._last = now


def _retry_after_seconds(response: httpx.Response) -> float | None:
    """``Retry-After`` in Sekunden; HTTP-Datumsangaben werden ignoriert."""
    raw = response.headers.get("retry-after")
    if not raw:
        return None
    try:
        return max(0.0, float(raw.strip()))
    except ValueError:
        return None


def request_with_backoff(
    client: httpx.Client,
    url: str,
    *,
    params: dict[str, Any] | None = None,
    limiter: RateLimiter | None = None,
    stats: HarvestStats | None = None,
    retries: int = 4,
    base_delay: float = 2.0,
    max_delay: float = 60.0,
    sleep: Callable[[float], None] = time.sleep,
) -> httpx.Response:
    """GET mit Ratenbegrenzung, exponentiellem Backoff und ``Retry-After``.

    arXiv beantwortet zu dichte OAI-Abfragen mit ``503`` **und** einem
    ``Retry-After``-Header; wer den ignoriert, wird ausgesperrt statt gedrosselt.
    Der Header hat deshalb Vorrang vor der eigenen Wartekurve.
    """
    last: Exception | None = None
    for attempt in range(retries):
        if limiter is not None:
            limiter.wait()
        if stats is not None:
            stats.requests += 1

        # Wartezeit dieses Durchgangs: eigene Kurve, sofern die Antwort nichts
        # Besseres vorgibt.
        wait = min(max_delay, base_delay * 2**attempt)
        try:
            response = client.get(url, params=params)
        except httpx.HTTPError as exc:  # Netzfehler: erneut versuchen
            last = exc
        else:
            if response.status_code not in RETRY_STATUS:
                response.raise_for_status()
                return response
            last = httpx.HTTPStatusError(
                f"HTTP {response.status_code}", request=response.request, response=response
            )
            wait = _retry_after_seconds(response) or wait

        if attempt == retries - 1:
            break
        if stats is not None:
            stats.retries += 1
        sleep(wait)

    raise HarvestError(f"{url} nach {retries} Versuchen aufgegeben: {last}")


# ------------------------------------------------------------------ Dedupe


class Deduper:
    """Dubletten über DOI **und** Titelschlüssel.

    Beide Wege sind nötig: Preprints tragen oft keine DOI, und dieselbe Arbeit
    erscheint auf arXiv und OpenReview unter identischem Titel. Der Index ist
    quellenübergreifend — genau dafür ist er da.
    """

    def __init__(self, dois: Iterable[str] = (), titles: Iterable[str] = ()) -> None:
        self._dois = {d for d in (normalize_doi(x) for x in dois) if d}
        self._titles = {t for t in (title_key(x) for x in titles) if t}

    def __len__(self) -> int:
        return len(self._dois) + len(self._titles)

    def seen(self, record: HarvestRecord) -> bool:
        doi = normalize_doi(record.doi)
        if doi and doi in self._dois:
            return True
        key = record.title_key
        return bool(key) and key in self._titles

    def add(self, record: HarvestRecord) -> None:
        doi = normalize_doi(record.doi)
        if doi:
            self._dois.add(doi)
        key = record.title_key
        if key:
            self._titles.add(key)


# ------------------------------------------------------------------ Fortschritt


@dataclass
class SourceState:
    """Wo der letzte Lauf einer Quelle stehen geblieben ist."""

    #: Bis hierhin ist geerntet — Startpunkt des nächsten Delta-Laufs.
    cursor: str | None = None
    #: Offener Blätter-Zeiger (OAI-``resumptionToken`` bzw. REST-Offset).
    resume: str | None = None
    last_run: str | None = None
    records: int = 0


class HarvestState:
    """Lauf-Zustand als JSON-Datei, eine Sektion je Quelle.

    Ein abgebrochener Lauf ist der Normalfall, nicht die Ausnahme: OAI-Ernten
    laufen über hunderte Seiten. Der Blätter-Zeiger wird deshalb mitgeschrieben,
    damit ein Neustart nicht wieder von vorn beginnt.
    """

    def __init__(self, path: Path) -> None:
        self.path = path
        self._data: dict[str, dict[str, Any]] = {}
        if path.exists():
            try:
                loaded = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    self._data = loaded
            except (json.JSONDecodeError, OSError):
                # Kaputter Zustand darf einen Lauf nicht verhindern — dann eben von vorn.
                self._data = {}

    def get(self, source: str) -> SourceState:
        raw = self._data.get(source) or {}
        return SourceState(
            cursor=raw.get("cursor"),
            resume=raw.get("resume"),
            last_run=raw.get("last_run"),
            records=int(raw.get("records") or 0),
        )

    def set(self, source: str, state: SourceState) -> None:
        self._data[source] = asdict(state)

    def save(self) -> None:
        """Atomar schreiben — ein Abbruch mittendrin darf den Zustand nicht zerstören."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp.write_text(json.dumps(self._data, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self.path)


def utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


# ------------------------------------------------------------------ Senke

#: Wohin geerntete Datensätze gehen. Default schreibt JSONL; Phase 11.5 hängt hier
#: die Datenbank an, ohne dass ein Harvester davon weiß.
Sink = Callable[[HarvestRecord], None]


class JsonlSink:
    """Datensätze als JSON Lines anhängen (eine Datei je Quelle)."""

    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self._handle = path.open("a", encoding="utf-8")

    def __call__(self, record: HarvestRecord) -> None:
        self._handle.write(json.dumps(record.to_json(), ensure_ascii=False) + "\n")

    def close(self) -> None:
        self._handle.close()

    def __enter__(self) -> JsonlSink:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


__all__ = [
    "Deduper",
    "HarvestError",
    "HarvestRecord",
    "HarvestState",
    "HarvestStats",
    "JsonlSink",
    "RateLimiter",
    "Sink",
    "SourceState",
    "USER_AGENT",
    "inverted_index",
    "normalize_doi",
    "request_with_backoff",
    "strip_emails",
    "title_key",
    "utc_now",
]
