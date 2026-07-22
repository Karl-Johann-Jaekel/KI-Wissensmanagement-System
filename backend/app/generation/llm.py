"""Chat LLM clients — Ollama (local) and Mistral (EU API), streaming.

Both expose ``chat_stream(messages) -> Iterator[str]`` yielding text deltas, and a
``chat()`` convenience that joins them. Which one is used is decided by the zone
router (PLAN §2, §7 Phase 5), never here.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Protocol

import httpx

MISTRAL_API = "https://api.mistral.ai"


class LLMClient(Protocol):
    name: str

    def chat_stream(self, messages: list[dict]) -> Iterator[str]: ...

    def chat(self, messages: list[dict]) -> str: ...


class OllamaChatClient:
    """Local, confidential-safe. Talks to Ollama /api/chat (NDJSON stream)."""

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


class MistralChatClient:
    """Public zone only (EU API, AVV). Talks to /v1/chat/completions (SSE stream)."""

    name = "mistral"

    def __init__(self, api_key: str, model: str, *, client: httpx.Client | None = None) -> None:
        self.model = model
        self._client = client or httpx.Client(
            base_url=MISTRAL_API,
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
