"""OpenReview über API v2 ernten (PLAN §7 Phase 11.3).

OpenReview ist unter den Quellen die einzige, die **Gutachten und Erwiderungen**
offen führt — deshalb steht sie im Plan. Der Harvester holt hier die Einreichungen;
die Diskussion hängt je Einreichung an ``extra.forum`` und ist ein eigener Schritt
(ein Forum kostet eine weitere Anfrage, das gehört nicht in den Delta-Lauf).

**Zugang (geprüft am 18.08.2026):** Anonyme Anfragen an ``api2.openreview.net``
beantwortet der Dienst mit ``403 ChallengeRequiredError`` — einem Bot-Schutz mit
Browser-Challenge. Der Harvester löst diese Challenge nicht und versucht es auch
nicht; er meldet stattdessen klar, dass ein Konto nötig ist. Mit
``OPENREVIEW_USERNAME``/``OPENREVIEW_PASSWORD`` meldet er sich an und verwendet das
Bearer-Token. Ein Konto ist kostenlos.

Datenschutz: ``authorids`` wird **nicht** übernommen. Das Feld enthält bei nicht
registrierten Autor:innen wörtlich E-Mail-Adressen (PLAN §7 Phase 11).
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, date, datetime
from typing import Any

import httpx

from app.corpus.harvest.base import (
    USER_AGENT,
    Deduper,
    HarvestError,
    HarvestRecord,
    HarvestStats,
    RateLimiter,
    Sink,
    inverted_index,
    request_with_backoff,
    strip_emails,
    utc_now,
)

SOURCE = "openreview"
BASE_URL = "https://api2.openreview.net"
NOTES_ENDPOINT = f"{BASE_URL}/notes"
LOGIN_ENDPOINT = f"{BASE_URL}/login"
FORUM_URL = "https://openreview.net/forum?id={id}"

#: Serverseitige Obergrenze je Seite.
PAGE_SIZE = 1000
POLITE_INTERVAL_S = 1.0

#: Fehlername des Bot-Schutzes. Erneute Versuche helfen dagegen nicht.
CHALLENGE_ERROR = "ChallengeRequiredError"


class ChallengeRequired(HarvestError):
    """OpenReview verlangt eine Browser-Challenge — nur mit Konto zu umgehen."""


def login(client: httpx.Client, username: str, password: str) -> str:
    """Bearer-Token holen. Ohne Token ist der Dienst für Automaten geschlossen."""
    response = client.post(LOGIN_ENDPOINT, json={"id": username, "password": password})
    if response.status_code == 403 and CHALLENGE_ERROR in response.text:
        raise ChallengeRequired("Login selbst ist challenge-geschützt")
    response.raise_for_status()
    token = response.json().get("token")
    if not token:
        raise HarvestError("OpenReview-Login lieferte kein Token")
    return str(token)


def _value(content: dict[str, Any], key: str) -> Any:
    """API v2 verpackt jeden Inhalt als ``{"value": …}``."""
    raw = content.get(key)
    if isinstance(raw, dict) and "value" in raw:
        return raw["value"]
    return raw


def _ms(value: date | datetime | str | int | None) -> int | None:
    """Zeitangabe → Millisekunden seit Epoch (das Format von ``mintmdate``)."""
    if value is None:
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    if isinstance(value, datetime):
        moment = value if value.tzinfo else value.replace(tzinfo=UTC)
    else:
        moment = datetime(value.year, value.month, value.day, tzinfo=UTC)
    return int(moment.timestamp() * 1000)


def _iso_from_ms(value: Any) -> str | None:
    if not isinstance(value, int | float):
        return None
    return datetime.fromtimestamp(value / 1000, tz=UTC).isoformat(timespec="seconds")


def parse_note(note: dict, *, fetched_at: str, fetched_by: str) -> HarvestRecord | None:
    """Eine Note → ``HarvestRecord``; ``None``, wenn sie keine Einreichung ist."""
    note_id = str(note.get("id") or "")
    content = note.get("content") or {}
    title = " ".join(str(_value(content, "title") or "").split())
    if not note_id or not title:
        return None

    raw_authors = _value(content, "authors") or []
    authors = [
        cleaned
        for cleaned in (strip_emails(str(a)) for a in raw_authors if a)
        # authorids bleibt bewusst außen vor; hier landen nur Anzeigenamen.
        if cleaned
    ]
    venue = _value(content, "venue") or _value(content, "venueid")

    return HarvestRecord(
        source=SOURCE,
        source_id=note_id,
        title=title,
        source_url=FORUM_URL.format(id=note.get("forum") or note_id),
        fetched_at=fetched_at,
        fetched_by=fetched_by,
        doi=str(_value(content, "DOI") or "") or None,
        authors=authors,
        published=_iso_from_ms(note.get("cdate")),
        updated=_iso_from_ms(note.get("mdate") or note.get("tmdate")),
        categories=[str(venue)] if venue else [],
        # Abstract nur als invertierter Index — kein Rohtext aus dieser Quelle.
        abstract_index=inverted_index(str(_value(content, "abstract") or "")),
        # Über die Forum-Id hängen Gutachten und Erwiderungen; ein eigener Schritt.
        extra={"forum": note.get("forum"), "venue": venue},
    )


def harvest(
    *,
    venue_ids: tuple[str, ...],
    since: date | datetime | str | int | None = None,
    sink: Sink,
    client: httpx.Client | None = None,
    token: str | None = None,
    deduper: Deduper | None = None,
    stats: HarvestStats | None = None,
    limiter: RateLimiter | None = None,
    cap: int | None = None,
    page_size: int = PAGE_SIZE,
    on_page: Callable[[str | None], None] | None = None,
    fetched_by: str = USER_AGENT,
) -> HarvestStats:
    """Delta-Ernte je Venue über ``mintmdate`` (Änderungszeitstempel)."""
    stats = stats or HarvestStats()
    deduper = deduper if deduper is not None else Deduper()
    limiter = limiter or RateLimiter(POLITE_INTERVAL_S)
    own = client is None
    headers = {"User-Agent": USER_AGENT}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    http = client or httpx.Client(headers=headers, timeout=120.0, follow_redirects=True)
    fetched_at = utc_now()
    mintmdate = _ms(since)

    try:
        for venue in venue_ids:
            offset = 0
            while cap is None or stats.records < cap:
                params: dict[str, Any] = {
                    "content.venueid": venue,
                    "limit": page_size,
                    "offset": offset,
                    "sort": "mdate:asc",
                }
                if mintmdate is not None:
                    params["mintmdate"] = mintmdate
                response = request_with_backoff(
                    http, NOTES_ENDPOINT, params=params, limiter=limiter, stats=stats
                )
                payload = response.json()
                _reject_challenge(payload)
                notes = payload.get("notes") or []
                for note in notes:
                    if cap is not None and stats.records >= cap:
                        break
                    _emit(note, sink, deduper, stats, fetched_at, fetched_by)
                offset += len(notes)
                if on_page is not None:
                    on_page(str(offset) if len(notes) == page_size else None)
                if len(notes) < page_size:
                    break
    finally:
        if own:
            http.close()
    return stats


def _reject_challenge(payload: Any) -> None:
    """Bot-Schutz sofort und deutlich melden statt blind weiterzublättern."""
    if isinstance(payload, dict) and payload.get("name") == CHALLENGE_ERROR:
        raise ChallengeRequired(
            "OpenReview verlangt eine Browser-Challenge. Ein Konto anlegen und "
            "OPENREVIEW_USERNAME/OPENREVIEW_PASSWORD setzen — die Challenge wird "
            "bewusst nicht umgangen."
        )


def _emit(
    note: dict,
    sink: Sink,
    deduper: Deduper,
    stats: HarvestStats,
    fetched_at: str,
    fetched_by: str,
) -> None:
    try:
        record = parse_note(note, fetched_at=fetched_at, fetched_by=fetched_by)
    except (ValueError, TypeError, AttributeError):
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


__all__ = [
    "BASE_URL",
    "SOURCE",
    "ChallengeRequired",
    "harvest",
    "login",
    "parse_note",
]
