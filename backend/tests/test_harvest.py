"""Harvester-Grundgerüst (PLAN §7 Phase 11.3).

Kein Test geht ins Netz — alle Quellen laufen über ``httpx.MockTransport``, Uhr und
Schlaf sind injiziert. Geprüft werden die vier Eigenschaften, an denen ein Harvester
im Betrieb scheitert: Höflichkeit, Ausfallverhalten, Dubletten, Wiederaufnahme —
plus die beiden Datenschutz-Leitplanken (kein Abstract-Rohtext, keine E-Mails).
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import httpx
import pytest

from app.corpus.harvest import arxiv_oai, openreview
from app.corpus.harvest.base import (
    Deduper,
    HarvestError,
    HarvestRecord,
    HarvestState,
    HarvestStats,
    JsonlSink,
    RateLimiter,
    SourceState,
    inverted_index,
    normalize_doi,
    request_with_backoff,
    strip_emails,
    title_key,
)
from app.corpus.harvest.oai import StaleResumptionToken, iter_records

# --------------------------------------------------------------- Normalisierung


def test_inverted_index_keeps_positions_and_folds_case() -> None:
    assert inverted_index("Retrieval augmented retrieval") == {
        "retrieval": [0, 2],
        "augmented": [1],
    }
    assert inverted_index("") == {}
    assert inverted_index(None) == {}


def test_normalize_doi_strips_resolver_prefixes() -> None:
    assert normalize_doi("https://doi.org/10.1145/ABC") == "10.1145/abc"
    assert normalize_doi("doi:10.1145/abc") == "10.1145/abc"
    assert normalize_doi("  ") is None
    assert normalize_doi(None) is None


def test_title_key_ignores_punctuation_and_case() -> None:
    assert title_key("ColBERT: Efficient Search!") == title_key("colbert efficient search")
    assert title_key(None) == ""


def test_strip_emails_removes_contact_data() -> None:
    assert strip_emails("Ada Lovelace ada@example.org") == "Ada Lovelace"
    assert strip_emails("ada@example.org") == ""


# --------------------------------------------------------------- Höflichkeit


def test_rate_limiter_spaces_requests() -> None:
    now = [0.0]
    slept: list[float] = []

    def sleep(seconds: float) -> None:
        slept.append(seconds)
        now[0] += seconds

    limiter = RateLimiter(5.0, clock=lambda: now[0], sleep=sleep)
    limiter.wait()  # erste Anfrage wartet nicht
    now[0] += 1.0
    limiter.wait()  # 1 s vergangen -> 4 s nachschlafen
    assert slept == [4.0]

    now[0] += 99.0
    limiter.wait()  # längst überfällig -> gar nicht warten
    assert slept == [4.0]


# --------------------------------------------------------------- Ausfallverhalten


def test_backoff_retries_and_honours_retry_after() -> None:
    attempts: list[int] = []
    slept: list[float] = []

    def handle(request: httpx.Request) -> httpx.Response:
        attempts.append(1)
        if len(attempts) < 3:
            return httpx.Response(503, headers={"Retry-After": "7"}, text="busy")
        return httpx.Response(200, text="ok")

    stats = HarvestStats()
    client = httpx.Client(transport=httpx.MockTransport(handle))
    response = request_with_backoff(
        client, "https://example.org/oai", stats=stats, sleep=slept.append
    )

    assert response.text == "ok"
    assert len(attempts) == 3
    # Der Header schlägt die eigene Wartekurve (2 s, 4 s) — sonst sperrt arXiv aus.
    assert slept == [7.0, 7.0]
    assert stats.requests == 3
    assert stats.retries == 2


def test_backoff_gives_up_with_a_clear_error() -> None:
    client = httpx.Client(transport=httpx.MockTransport(lambda _r: httpx.Response(500)))
    with pytest.raises(HarvestError, match="nach 2 Versuchen"):
        request_with_backoff(client, "https://example.org/oai", retries=2, sleep=lambda _s: None)


def test_backoff_does_not_retry_a_client_error() -> None:
    calls: list[int] = []

    def handle(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(404, text="nope")

    client = httpx.Client(transport=httpx.MockTransport(handle))
    with pytest.raises(httpx.HTTPStatusError):
        request_with_backoff(client, "https://example.org/oai", sleep=lambda _s: None)
    assert len(calls) == 1


# --------------------------------------------------------------- Dedupe


def _record(**kwargs: object) -> HarvestRecord:
    base = {
        "source": "arxiv",
        "source_id": "1",
        "title": "A Paper",
        "source_url": "https://arxiv.org/abs/1",
        "fetched_at": "2026-08-18T00:00:00+00:00",
        "fetched_by": "test",
    }
    return HarvestRecord(**{**base, **kwargs})  # type: ignore[arg-type]


def test_deduper_matches_on_doi_across_sources() -> None:
    deduper = Deduper()
    first = _record(doi="https://doi.org/10.1/X", title="Erst so")
    deduper.add(first)
    later = _record(source="openreview", doi="10.1/x", title="Ganz anders betitelt")
    assert deduper.seen(later)


def test_deduper_matches_on_title_when_the_doi_is_missing() -> None:
    """Preprints tragen oft keine DOI — ohne Titelpfad blieben sie Dubletten."""
    deduper = Deduper()
    deduper.add(_record(title="ColBERT: Efficient Search"))
    assert deduper.seen(_record(source="openreview", title="colbert efficient search!"))
    assert not deduper.seen(_record(title="Ein anderes Paper"))


def test_deduper_seeded_from_previous_harvests() -> None:
    deduper = Deduper(["10.1/x"], ["Bekannter Titel"])
    assert deduper.seen(_record(doi="10.1/X", title="Neu"))
    assert deduper.seen(_record(title="bekannter titel"))


# --------------------------------------------------------------- OAI-Protokoll

PAGE_TEMPLATE = """<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/">
  <ListRecords>
    {records}
    {token}
  </ListRecords>
</OAI-PMH>
"""

RECORD_TEMPLATE = """
    <record>
      <header><identifier>oai:arXiv.org:{id}</identifier><datestamp>2026-08-05</datestamp></header>
      <metadata>
        <arXiv xmlns="http://arxiv.org/OAI/arXiv/">
          <id>{id}</id>
          <created>2026-08-04</created>
          <updated>2026-08-05</updated>
          <authors>
            <author><keyname>Lovelace</keyname><forenames>Ada</forenames></author>
            <author><keyname>Turing alan@example.org</keyname><forenames>Alan</forenames></author>
          </authors>
          <title>{title}</title>
          <categories>cs.IR cs.LG</categories>
          <abstract>Retrieval augmented retrieval works well.</abstract>
          <doi>10.1145/{id}</doi>
          <license>http://arxiv.org/licenses/nonexclusive-distrib/1.0/</license>
        </arXiv>
      </metadata>
    </record>
"""

DELETED_RECORD = """
    <record>
      <header status="deleted"><identifier>oai:arXiv.org:9</identifier></header>
    </record>
"""

EMPTY_RESPONSE = """<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/">
  <error code="noRecordsMatch">nothing here</error>
</OAI-PMH>
"""

STALE_RESPONSE = """<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/">
  <error code="badResumptionToken">expired</error>
</OAI-PMH>
"""


def _page(ids: list[str], token: str = "") -> str:
    records = "".join(RECORD_TEMPLATE.format(id=i, title=f"Paper {i}") for i in ids)
    marker = f"<resumptionToken>{token}</resumptionToken>" if token else ""
    return PAGE_TEMPLATE.format(records=records, token=marker)


def test_oai_follows_resumption_tokens_and_reports_progress() -> None:
    seen_params: list[dict[str, str]] = []
    tokens: list[str | None] = []

    def handle(request: httpx.Request) -> httpx.Response:
        params = dict(request.url.params)
        seen_params.append(params)
        if params.get("resumptionToken") == "page2":
            return httpx.Response(200, text=_page(["3"]))
        return httpx.Response(200, text=_page(["1", "2"], token="page2"))

    client = httpx.Client(transport=httpx.MockTransport(handle))
    records = list(
        iter_records(
            client,
            "https://oai.example.org",
            metadata_prefix="arXiv",
            since="2026-08-01",
            set_spec="cs:cs:IR",
            on_page=tokens.append,
        )
    )

    assert len(records) == 3
    assert tokens == ["page2", None]
    # Der Zeiger trägt Zeitraum und Set bereits in sich; mitgeschickt wäre er ungültig.
    assert seen_params[0]["from"] == "2026-08-01"
    assert seen_params[1] == {"verb": "ListRecords", "resumptionToken": "page2"}


def test_oai_treats_no_records_match_as_an_empty_result() -> None:
    client = httpx.Client(
        transport=httpx.MockTransport(lambda _r: httpx.Response(200, text=EMPTY_RESPONSE))
    )
    tokens: list[str | None] = []
    records = list(
        iter_records(
            client, "https://oai.example.org", metadata_prefix="arXiv", on_page=tokens.append
        )
    )
    assert records == []
    assert tokens == [None]


def test_oai_reports_a_stale_token_so_the_run_can_restart() -> None:
    client = httpx.Client(
        transport=httpx.MockTransport(lambda _r: httpx.Response(200, text=STALE_RESPONSE))
    )
    with pytest.raises(StaleResumptionToken):
        list(iter_records(client, "https://oai.example.org", metadata_prefix="arXiv", resume="alt"))


# --------------------------------------------------------------- arXiv


def test_arxiv_record_carries_no_abstract_text_and_no_emails() -> None:
    collected: list[HarvestRecord] = []
    client = httpx.Client(
        transport=httpx.MockTransport(lambda _r: httpx.Response(200, text=_page(["2505.17810"])))
    )
    arxiv_oai.harvest(
        since=date(2026, 8, 1),
        sets=("cs:cs:IR",),
        sink=collected.append,
        client=client,
        limiter=RateLimiter(0.0),
    )

    assert len(collected) == 1
    record = collected[0]
    assert record.source_id == "2505.17810"
    assert record.doi == "10.1145/2505.17810"
    assert record.categories == ["cs.IR", "cs.LG"]
    assert record.source_url == "https://arxiv.org/abs/2505.17810"
    # Leitplanke 1: Abstract nur als Index, nirgends als Rohtext.
    assert record.abstract_index["retrieval"] == [0, 2]
    assert not hasattr(record, "abstract")
    assert "works well" not in json.dumps(record.to_json())
    # Leitplanke 2: keine Kontaktdaten in den Autorennamen.
    assert record.authors == ["Ada Lovelace", "Alan Turing"]


def test_arxiv_skips_deleted_records_without_failing() -> None:
    page = PAGE_TEMPLATE.format(
        records=RECORD_TEMPLATE.format(id="1", title="Gut") + DELETED_RECORD, token=""
    )
    collected: list[HarvestRecord] = []
    client = httpx.Client(transport=httpx.MockTransport(lambda _r: httpx.Response(200, text=page)))
    stats = arxiv_oai.harvest(
        since="2026-08-01",
        sets=("cs:cs:IR",),
        sink=collected.append,
        client=client,
        stats=HarvestStats(),
        limiter=RateLimiter(0.0),
    )
    assert stats.records == 1
    assert stats.skipped == 1
    assert stats.failed == 0


def test_arxiv_cap_stops_the_run() -> None:
    client = httpx.Client(
        transport=httpx.MockTransport(lambda _r: httpx.Response(200, text=_page(["1", "2", "3"])))
    )
    collected: list[HarvestRecord] = []
    stats = arxiv_oai.harvest(
        since="2026-08-01",
        sets=("cs:cs:IR", "cs:cs:LG"),
        sink=collected.append,
        client=client,
        cap=2,
        limiter=RateLimiter(0.0),
    )
    assert stats.records == 2
    assert len(collected) == 2


def test_arxiv_deduplicates_the_same_paper_in_two_sets() -> None:
    """Ein Paper mit cs.IR **und** cs.LG kommt in beiden Set-Ernten vor."""
    client = httpx.Client(
        transport=httpx.MockTransport(lambda _r: httpx.Response(200, text=_page(["1"])))
    )
    collected: list[HarvestRecord] = []
    stats = arxiv_oai.harvest(
        since="2026-08-01",
        sets=("cs:cs:IR", "cs:cs:LG"),
        sink=collected.append,
        client=client,
        limiter=RateLimiter(0.0),
    )
    assert stats.records == 1
    assert stats.duplicates == 1


# --------------------------------------------------------------- OpenReview


def _note(note_id: str, title: str, mdate: int = 1_755_000_000_000) -> dict:
    return {
        "id": note_id,
        "forum": note_id,
        "cdate": 1_750_000_000_000,
        "mdate": mdate,
        "content": {
            "title": {"value": title},
            "abstract": {"value": "Peer review matters here"},
            "authors": {"value": ["Ada Lovelace", "Alan Turing alan@example.org"]},
            "authorids": {"value": ["~ada1", "alan@example.org"]},
            "venue": {"value": "ICLR 2025"},
        },
    }


def test_openreview_note_drops_authorids_and_raw_abstract() -> None:
    record = openreview.parse_note(
        _note("abc", "Ein Gutachten-Paper"), fetched_at="t", fetched_by="test"
    )
    assert record is not None
    assert record.authors == ["Ada Lovelace", "Alan Turing"]
    payload = json.dumps(record.to_json())
    # authorids enthält bei Unregistrierten wörtlich E-Mail-Adressen.
    assert "alan@example.org" not in payload
    assert "~ada1" not in payload
    assert "Peer review matters here" not in payload
    assert record.abstract_index["peer"] == [0]
    # Die Forum-Id trägt den Weg zu Gutachten und Erwiderungen.
    assert record.extra["forum"] == "abc"


def test_openreview_pages_until_a_short_page() -> None:
    seen: list[int] = []

    def handle(request: httpx.Request) -> httpx.Response:
        offset = int(request.url.params.get("offset", 0))
        seen.append(offset)
        notes = (
            [_note(f"n{offset}", f"Paper {offset}"), _note(f"m{offset}", f"Andere {offset}")]
            if offset == 0
            else [_note("last", "Letztes Paper")]
        )
        return httpx.Response(200, json={"notes": notes, "count": 3})

    collected: list[HarvestRecord] = []
    client = httpx.Client(transport=httpx.MockTransport(handle))
    stats = openreview.harvest(
        venue_ids=("ICLR.cc/2025/Conference",),
        since=date(2026, 8, 1),
        sink=collected.append,
        client=client,
        page_size=2,
        limiter=RateLimiter(0.0),
    )
    assert seen == [0, 2]
    assert stats.records == 3


def test_openreview_sends_the_modification_filter() -> None:
    captured: list[dict[str, str]] = []

    def handle(request: httpx.Request) -> httpx.Response:
        captured.append(dict(request.url.params))
        return httpx.Response(200, json={"notes": []})

    client = httpx.Client(transport=httpx.MockTransport(handle))
    openreview.harvest(
        venue_ids=("ICLR.cc/2025/Conference",),
        since=date(2026, 8, 1),
        sink=lambda _r: None,
        client=client,
        limiter=RateLimiter(0.0),
    )
    # 2026-08-01T00:00:00Z in Millisekunden
    assert captured[0]["mintmdate"] == "1785542400000"
    assert captured[0]["sort"] == "mdate:asc"


def test_openreview_reports_the_bot_challenge_instead_of_retrying() -> None:
    """403 mit Challenge ist kein Netzproblem — Wiederholen hilft nicht, ein Konto schon."""
    client = httpx.Client(
        transport=httpx.MockTransport(
            lambda _r: httpx.Response(200, json={"name": "ChallengeRequiredError"})
        )
    )
    with pytest.raises(openreview.ChallengeRequired, match="OPENREVIEW_USERNAME"):
        openreview.harvest(
            venue_ids=("ICLR.cc/2025/Conference",),
            sink=lambda _r: None,
            client=client,
            limiter=RateLimiter(0.0),
        )


# --------------------------------------------------------------- Zustand & Senke


def test_state_round_trip_and_resume(tmp_path: Path) -> None:
    path = tmp_path / "state.json"
    state = HarvestState(path)
    state.set("arxiv", SourceState(cursor="2026-08-01", resume="tok", records=12))
    state.save()

    reloaded = HarvestState(path).get("arxiv")
    assert reloaded.cursor == "2026-08-01"
    assert reloaded.resume == "tok"
    assert reloaded.records == 12


def test_broken_state_file_does_not_block_a_run(tmp_path: Path) -> None:
    path = tmp_path / "state.json"
    path.write_text("{kaputt", encoding="utf-8")
    assert HarvestState(path).get("arxiv") == SourceState()


def test_jsonl_sink_appends_one_line_per_record(tmp_path: Path) -> None:
    path = tmp_path / "arxiv.jsonl"
    with JsonlSink(path) as sink:
        sink(_record(title="Erstes"))
        sink(_record(source_id="2", title="Zweites"))
    with JsonlSink(path) as sink:
        sink(_record(source_id="3", title="Drittes"))

    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
    assert [r["title"] for r in rows] == ["Erstes", "Zweites", "Drittes"]
