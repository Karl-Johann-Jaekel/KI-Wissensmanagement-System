"""LLM-Auswahl und Rückfallebene (ADR-0021).

Reihenfolge: Groq mit Mistral dahinter, sonst der eine vorhandene Anbieter,
sonst lokales Ollama.
"""

from __future__ import annotations

import httpx
import pytest

from app.core.config import Settings
from app.core.llm_router import choose_client
from app.generation.llm import (
    FallbackChatClient,
    GroqChatClient,
    MistralChatClient,
    OllamaChatClient,
)

# Beide Schlüssel immer ausdrücklich setzen: Settings() liest die .env des
# Betreibers mit, ein dort hinterlegter GROQ_API_KEY würde sonst die Erwartung
# kippen (dieselbe Falle wie beim EMBED_PROVIDER, ADR-0014).


def test_uses_mistral_when_key_present() -> None:
    client = choose_client(settings=Settings(mistral_api_key="sk-x", groq_api_key=""))
    assert isinstance(client, MistralChatClient)
    assert client.name == "mistral"


def test_falls_back_to_ollama_without_key() -> None:
    client = choose_client(settings=Settings(mistral_api_key="", groq_api_key=""))
    assert isinstance(client, OllamaChatClient)
    assert client.name == "ollama"


def test_uses_groq_alone_when_only_groq_configured() -> None:
    client = choose_client(settings=Settings(groq_api_key="gsk-x", mistral_api_key=""))
    assert isinstance(client, GroqChatClient)
    assert client.name == "groq"


def test_pairs_groq_with_mistral_when_both_configured() -> None:
    client = choose_client(settings=Settings(groq_api_key="gsk-x", mistral_api_key="sk-x"))
    assert isinstance(client, FallbackChatClient)
    # Vor dem ersten Zug meldet der Wrapper den primären Anbieter.
    assert client.name == "groq"


def _http_error(status: int) -> httpx.HTTPStatusError:
    return httpx.HTTPStatusError(
        f"status {status}",
        request=httpx.Request("POST", "https://example.invalid"),
        response=httpx.Response(status),
    )


class _Rejecting:
    """Weist ab, bevor ein Token fließt — der Groq-429-Fall."""

    name = "primary"
    model = "primary-model"

    def __init__(self) -> None:
        self.calls = 0

    def chat_stream(self, messages: list[dict]):
        self.calls += 1
        raise _http_error(429)
        yield  # pragma: no cover — macht die Funktion zum Generator

    def chat(self, messages: list[dict]) -> str:
        return "".join(self.chat_stream(messages))


class _Breaking:
    """Liefert erst ein Token und bricht dann ab — stiller Wechsel unmöglich."""

    name = "primary"
    model = "primary-model"

    def chat_stream(self, messages: list[dict]):
        yield "Halber "
        raise _http_error(429)

    def chat(self, messages: list[dict]) -> str:
        return "".join(self.chat_stream(messages))


class _Answering:
    name = "secondary"
    model = "secondary-model"

    def __init__(self) -> None:
        self.calls = 0

    def chat_stream(self, messages: list[dict]):
        self.calls += 1
        yield "Antwort "
        yield "vom Rückfall."

    def chat(self, messages: list[dict]) -> str:
        return "".join(self.chat_stream(messages))


def test_fallback_switches_silently_before_first_token() -> None:
    primary, secondary = _Rejecting(), _Answering()
    client = FallbackChatClient(primary, secondary)

    assert client.chat([{"role": "user", "content": "x"}]) == "Antwort vom Rückfall."
    assert primary.calls == 1
    # Das sources-Ereignis liest name/model erst nach dem Strom — es muss den
    # Anbieter zeigen, der tatsächlich geantwortet hat.
    assert client.name == "secondary"
    assert client.model == "secondary-model"


def test_fallback_is_untouched_when_primary_answers() -> None:
    primary, secondary = _Answering(), _Rejecting()
    client = FallbackChatClient(primary, secondary)

    assert client.chat([{"role": "user", "content": "x"}]) == "Antwort vom Rückfall."
    assert secondary.calls == 0
    assert client.name == "secondary"  # Name des primären Clients (_Answering)


def test_fallback_does_not_retry_mid_stream() -> None:
    """Nach dem ersten Token wäre ein Wechsel ein doppelt geschriebener Satz."""
    secondary = _Answering()
    client = FallbackChatClient(_Breaking(), secondary)

    with pytest.raises(httpx.HTTPStatusError):
        client.chat([{"role": "user", "content": "x"}])
    assert secondary.calls == 0
