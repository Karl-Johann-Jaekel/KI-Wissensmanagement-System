"""Chat LLM clients — Ollama (local), Mistral (EU API) und Groq, streaming.

Alle bieten ``chat_stream(messages) -> Iterator[str]`` mit Text-Deltas und ein
``chat()``, das sie zusammenfügt. *Welcher* verwendet wird, entscheidet
``core.llm_router`` (PLAN §7 Phase 5), nie dieses Modul.

Mistral und Groq sprechen beide das OpenAI-Format (``/v1/chat/completions``, SSE)
und teilen sich deshalb eine Basisklasse; sie unterscheiden sich nur in Adresse,
Name und Modell. ``FallbackChatClient`` stellt beide hintereinander (ADR-0021).
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Protocol

import httpx

MISTRAL_API = "https://api.mistral.ai"
# Groq spricht das OpenAI-Format unter /openai/v1 — die Basis endet deshalb
# nicht auf der nackten Domain, sonst zeigt /v1/chat/completions ins Leere.
GROQ_API = "https://api.groq.com/openai"


class LLMClient(Protocol):
    name: str
    model: str

    def chat_stream(self, messages: list[dict]) -> Iterator[str]: ...

    def chat(self, messages: list[dict]) -> str: ...


class OllamaChatClient:
    """Local fallback without an API key. Talks to Ollama /api/chat (NDJSON stream)."""

    name = "ollama"

    def __init__(self, model: str, base_url: str, *, client: httpx.Client | None = None) -> None:
        self.model = model
        self._client = client or httpx.Client(base_url=base_url, timeout=120.0)

    def chat_stream(self, messages: list[dict]) -> Iterator[str]:
        with self._client.stream(
            "POST", "/api/chat", json={"model": self.model, "messages": messages, "stream": True}
        ) as resp:
            resp.raise_for_status()
            for line in resp.iter_lines():
                if not line:
                    continue
                data = json.loads(line)
                token = data.get("message", {}).get("content", "")
                if token:
                    yield token
                if data.get("done"):
                    break

    def chat(self, messages: list[dict]) -> str:
        return "".join(self.chat_stream(messages))


class _OpenAICompatChatClient:
    """Gemeinsame Basis für Anbieter mit OpenAI-kompatiblem SSE-Chat."""

    name = "openai-compat"
    base_url = ""

    def __init__(self, api_key: str, model: str, *, client: httpx.Client | None = None) -> None:
        self.model = model
        self._client = client or httpx.Client(
            base_url=self.base_url,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=120.0,
        )

    def chat_stream(self, messages: list[dict]) -> Iterator[str]:
        with self._client.stream(
            "POST",
            "/v1/chat/completions",
            json={"model": self.model, "messages": messages, "stream": True},
        ) as resp:
            resp.raise_for_status()
            for line in resp.iter_lines():
                if not line or not line.startswith("data:"):
                    continue
                payload = line[len("data:") :].strip()
                if payload == "[DONE]":
                    break
                delta = json.loads(payload)["choices"][0]["delta"].get("content")
                if delta:
                    yield delta

    def chat(self, messages: list[dict]) -> str:
        return "".join(self.chat_stream(messages))


class MistralChatClient(_OpenAICompatChatClient):
    """Mistral EU-API. Trägt auch die Embeddings (ADR-0014) und ist damit gesetzt."""

    name = "mistral"
    base_url = MISTRAL_API


class GroqChatClient(_OpenAICompatChatClient):
    """Groq. Im freien Tarif kostenlos, aber eng getaktet (ADR-0021)."""

    name = "groq"
    base_url = GROQ_API


class FallbackChatClient:
    """Zwei Anbieter hintereinander: der zweite springt ein, wenn der erste abweist.

    Groq prüft das Minutenkontingent, **bevor** es antwortet — ein 429 kommt also
    vor dem ersten Token, und der Wechsel bleibt für den Leser unsichtbar.

    Bricht der Strom dagegen *mitten* in der Antwort ab, ist ein stiller Wechsel
    nicht mehr möglich: der halbe Satz steht bereits beim Client, ein zweiter
    Anlauf würde ihn doppelt schreiben. Dann fliegt der Fehler weiter und
    ``api.chat`` macht daraus ein lesbares SSE-Ereignis.

    ``name`` und ``model`` zeigen, wer tatsächlich geantwortet hat — sie werden
    im Stream gesetzt und erst nach dessen Ende ausgelesen (``sources``-Ereignis).
    """

    def __init__(self, primary: LLMClient, fallback: LLMClient) -> None:
        self._primary = primary
        self._fallback = fallback
        self.name = primary.name
        self.model = primary.model

    def _use(self, client: LLMClient) -> None:
        self.name, self.model = client.name, client.model

    def chat_stream(self, messages: list[dict]) -> Iterator[str]:
        stream = self._primary.chat_stream(messages)
        try:
            first = next(stream)
        except StopIteration:  # leere Antwort — kein Grund zu wechseln
            self._use(self._primary)
            return
        except httpx.HTTPError:
            # Noch kein Token beim Client: der Wechsel bleibt unbemerkt.
            # Der abgebrochene Strom haelt eine offene Verbindung; schliessen,
            # sobald er es kann (das Protokoll verspricht nur einen Iterator).
            close = getattr(stream, "close", None)
            if close is not None:
                close()
            self._use(self._fallback)
            yield from self._fallback.chat_stream(messages)
            return
        self._use(self._primary)
        yield first
        yield from stream

    def chat(self, messages: list[dict]) -> str:
        return "".join(self.chat_stream(messages))
