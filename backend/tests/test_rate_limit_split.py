"""Lesewege und Modell-Endpunkte zählen getrennt — und Lesewege sind cachebar.

Beides hing zusammen und trat als ein Fehlerbild auf: Der Reiter „Dokumente"
meldete ``documents: HTTP 429``. Ursache war nicht die Last, sondern die
Buchführung. ``/documents`` teilte sich einen Zähler mit ``/chat`` — wer den eng
stellte, um den LLM-Anbieter zu schonen, drosselte damit das Blättern — und trug
keine Caching-Kopfzeile, also holte die Oberfläche die Liste bei jedem Mount neu.
Drei Seitenaufrufe, und der vierte kam als 429 zurück.

Geprüft wird an den Abhängigkeiten selbst, nicht über HTTP: ``/documents`` und
``/search`` brauchen eine Datenbank, die Zählerlogik nicht.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException, Response

from app.api.documents import _cache
from app.core import security
from app.core.config import get_settings
from app.core.security import SlidingWindowLimiter, rate_limit, rate_limit_llm


class FakeRequest:
    """Genug Request, um einen Client-Schlüssel daraus zu gewinnen."""

    def __init__(self, host: str = "1.2.3.4") -> None:
        self.client = type("C", (), {"host": host})()


@pytest.fixture
def tight(monkeypatch: pytest.MonkeyPatch) -> None:
    """Beide Takte eng stellen, damit die Grenze im Test erreichbar ist."""
    monkeypatch.setattr(get_settings(), "rate_limit", "3/minute", raising=False)
    monkeypatch.setattr(get_settings(), "rate_limit_llm", "2/minute", raising=False)
    security._limiter = None
    security._llm_limiter = None


@pytest.mark.usefixtures("tight")
class TestSeparateCounters:
    def test_reading_does_not_spend_the_model_budget(self) -> None:
        """Der Fehlerfall aus der Oberfläche: erst blättern, dann fragen."""
        req = FakeRequest()
        for _ in range(3):
            rate_limit(req)
        with pytest.raises(HTTPException):
            rate_limit(req)  # Lesetakt erschöpft …
        rate_limit_llm(req)  # … der Modelltakt aber nicht.

    def test_asking_does_not_spend_the_read_budget(self) -> None:
        req = FakeRequest()
        for _ in range(2):
            rate_limit_llm(req)
        with pytest.raises(HTTPException):
            rate_limit_llm(req)
        rate_limit(req)

    def test_each_limit_comes_from_its_own_setting(self) -> None:
        assert security._get_limiter().limit == 3
        assert security._get_llm_limiter().limit == 2

    def test_clients_are_counted_apart(self) -> None:
        for _ in range(3):
            rate_limit(FakeRequest("1.1.1.1"))
        rate_limit(FakeRequest("2.2.2.2"))  # anderer Besucher, eigener Eimer


class TestRetryAfter:
    def test_a_throttled_response_says_when_to_come_back(self) -> None:
        """Ohne die Kopfzeile kann die Oberfläche nur „irgendwann" sagen."""
        limiter = SlidingWindowLimiter("1/minute")
        limiter.check("a")
        with pytest.raises(HTTPException) as exc:
            limiter.check("a")
        assert exc.value.status_code == 429
        assert 1 <= int((exc.value.headers or {})["Retry-After"]) <= 60


class TestCacheHeaders:
    """Ohne Caching zahlt jeder Reiterwechsel erneut auf das Limit ein."""

    def test_reads_are_publicly_cacheable(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(get_settings(), "writes_enabled", False, raising=False)
        response = Response()
        _cache(response)
        assert response.headers["Cache-Control"] == "public, max-age=300"

    def test_writes_enabled_turns_caching_off(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Wo bearbeitet werden darf, stünde sonst der alte Stand im Browser."""
        monkeypatch.setattr(get_settings(), "writes_enabled", True, raising=False)
        response = Response()
        _cache(response)
        assert response.headers["Cache-Control"] == "private, no-store"
