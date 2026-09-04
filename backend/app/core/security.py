"""Lightweight API hardening (PLAN §7 Phase 5): rate limit, daily token cap, input cap.

In-process (single-instance) implementations — no extra dependency. Zwei per-IP
Gleitfenster begrenzen den Takt, ein Tageszaehler die Token-Ausgaben.

Zwei Fenster, weil die Endpunkte nicht dasselbe kosten: ``/documents`` und
``/graph`` sind zwischenspeicherbare Datenbankabfragen, ``/chat`` und ``/search``
kosten einen fremden Anbieter. Frueher teilten sie sich einen Zaehler — wer ihn
eng stellte, um den Anbieter zu schuetzen, drosselte damit das Blaettern in der
Oberflaeche, und der Reiter "Dokumente" endete in 429.

Beide Zaehler haengen am selben Schluessel: der Client-IP aus ``client_key``. Hinter
einem Proxy ist das nur dann die Besucher-IP, wenn dessen Adresse in uvicorns
``--forwarded-allow-ips`` steht (Default: nur 127.0.0.1) — sonst fallen alle Besucher
auf die Proxy-IP zusammen und teilen sich ein Limit. Siehe docker-compose.prod.yml.

Beide Zaehler sind Prozess-Globals: mit mehreren Workern vervielfacht sich das
effektive Limit (ADR-0003). Zugriffe laufen unter einer Sperre, weil die Handler
synchron sind und damit im Threadpool nebenlaeufig zaehlen.
"""

from __future__ import annotations

import math
import secrets
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

from app.core.config import get_settings

MAX_INPUT_CHARS = 2000

#: Aufraeumen nur alle N Pruefungen — sonst laeuft jede Anfrage ueber alle Schluessel.
_CLEANUP_EVERY = 512

_UNIT_SECONDS = {"second": 1, "minute": 60, "hour": 3600, "day": 86400}


def _parse_rate(rate: str) -> tuple[int, float]:
    count, _, per = rate.partition("/")
    return int(count), float(_UNIT_SECONDS[per.strip().rstrip("s")])


class SlidingWindowLimiter:
    def __init__(self, rate: str) -> None:
        self.limit, self.window = _parse_rate(rate)
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()
        self._since_cleanup = 0

    def check(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            dq = self._hits[key]
            while dq and now - dq[0] > self.window:
                dq.popleft()
            if len(dq) >= self.limit:
                # Ohne ``Retry-After`` weiß der Aufrufer nicht, ob er in einer
                # Sekunde oder in einer Stunde wiederkommen soll — und die
                # Oberfläche kann es ihm nicht sagen.
                wait = max(1, math.ceil(self.window - (now - dq[0])))
                raise HTTPException(
                    status_code=429,
                    detail="rate limit exceeded",
                    headers={"Retry-After": str(wait)},
                )
            dq.append(now)

            # Ohne das waechst der Zustand um einen Eintrag je gesehener IP und
            # wird nie kleiner — auf einem oeffentlichen Server ein Leck.
            self._since_cleanup += 1
            if self._since_cleanup >= _CLEANUP_EVERY:
                self._since_cleanup = 0
                idle = [k for k, d in self._hits.items() if not d or now - d[-1] > self.window]
                for stale in idle:
                    del self._hits[stale]


class TokenBudget:
    """Best-effort daily token cap **je Client** (resets at UTC midnight).

    Vorher war das ein einziger globaler Zaehler: ein Besucher konnte das Tagesbudget
    fuer alle anderen verbrauchen. Der Speicher ist durch den Tageswechsel begrenzt —
    beim ersten Aufruf eines neuen Tages faellt die ganze Tabelle weg.
    """

    def __init__(self, cap: int) -> None:
        self.cap = cap
        self._day: int | None = None
        self._used: dict[str, int] = {}
        self._lock = threading.Lock()

    def add(self, key: str, tokens: int) -> None:
        day = time.gmtime().tm_yday
        with self._lock:
            if day != self._day:
                self._day, self._used = day, {}
            if self._used.get(key, 0) >= self.cap:
                raise HTTPException(status_code=429, detail="daily token budget exhausted")
            self._used[key] = self._used.get(key, 0) + tokens

    def used_by(self, key: str) -> int:
        return self._used.get(key, 0)

    @property
    def used(self) -> int:
        """Summe ueber alle Clients — fuer Diagnose, nicht fuer die Grenze."""
        return sum(self._used.values())


_limiter: SlidingWindowLimiter | None = None
_llm_limiter: SlidingWindowLimiter | None = None
_budget: TokenBudget | None = None


def _get_limiter() -> SlidingWindowLimiter:
    global _limiter
    if _limiter is None:
        _limiter = SlidingWindowLimiter(get_settings().rate_limit)
    return _limiter


def _get_llm_limiter() -> SlidingWindowLimiter:
    global _llm_limiter
    if _llm_limiter is None:
        _llm_limiter = SlidingWindowLimiter(get_settings().rate_limit_llm)
    return _llm_limiter


def get_budget() -> TokenBudget:
    global _budget
    if _budget is None:
        _budget = TokenBudget(get_settings().daily_token_cap)
    return _budget


def client_key(request: Request) -> str:
    """Schluessel fuer Limit und Budget: die Client-IP, wie uvicorn sie sieht.

    uvicorn ersetzt die Adresse nur, wenn der Absender in ``--forwarded-allow-ips``
    steht; der Default deckt allein 127.0.0.1 ab. Steht der Proxy in einem eigenen
    Container, steht hier folglich dessen IP und *alle* Besucher teilen sich einen
    Eimer. Das ist keine theoretische Sorge: genau so lief es in Produktion, obwohl
    der Caddyfile den X-Forwarded-For eigens durchreicht.
    """
    return request.client.host if request.client else "unknown"


def rate_limit(request: Request) -> None:
    """Takt für die öffentlichen Lese-Endpunkte (Dokumente, Graph).

    Diese Antworten sind zwischenspeicherbar und kosten eine Datenbankabfrage.
    Sie teilten sich früher einen Zähler mit den Modell-Endpunkten: Wer das
    Limit eng stellte, um den LLM-Anbieter zu schonen, drosselte damit auch das
    Blättern in der Dokumentliste — drei Seitenaufrufe, und der vierte kam als
    ``429`` zurück. Deshalb zwei Zähler.
    """
    _get_limiter().check(client_key(request))


def rate_limit_llm(request: Request) -> None:
    """Takt für alles, was einen Anbieter kostet (Chat, Suche).

    Hier gilt der engere Wert: Eine RAG-Antwort kostet grob 2.000 bis 4.000
    Token, und Groqs freier Tarif ist auf 8.000 je Minute getaktet. Der Schutz
    gehört an diese Endpunkte — und nur an sie.
    """
    _get_llm_limiter().check(client_key(request))


def is_admin(request: Request) -> bool:
    """True if the request carries the admin API key (X-API-Key header).

    ``compare_digest`` statt ``==``: ein Vergleich, der beim ersten
    abweichenden Zeichen abbricht, verrät über die Laufzeit, wie viele Zeichen
    stimmten. Über viele Versuche lässt sich ein Schlüssel so zeichenweise
    erraten. Der Unterschied ist winzig und über das Netz schwer messbar — aber
    er kostet nichts.
    """
    provided = request.headers.get("X-API-Key")
    if not provided:
        return False
    return secrets.compare_digest(provided, get_settings().admin_api_key)


def require_admin(request: Request) -> None:
    if not is_admin(request):
        raise HTTPException(status_code=401, detail="admin API key required")


def require_writes_enabled() -> None:
    """Schreibrouten sind ausgeschaltet, solange WRITES_ENABLED false ist (ADR-0024).

    404 statt 403: nach aussen soll der Endpunkt nicht existieren. Ein 403 verriete,
    dass es ihn gibt und nur der Schluessel fehlt.
    """
    if not get_settings().writes_enabled:
        raise HTTPException(status_code=404, detail="Not Found")


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)
