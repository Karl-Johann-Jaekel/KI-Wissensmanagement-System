"""/chat SSE streaming with a fake LLM client (no DB / no Ollama)."""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

from app.generation.generate import AnswerPlan
from app.retrieval.search import SearchHit


class FakeClient:
    name = "fake"
    model = "fake-model"

    def chat_stream(self, messages: list[dict]):
        yield "Self-attention "
        yield "relates positions [Attention, Model]."

    def chat(self, messages: list[dict]) -> str:
        return "".join(self.chat_stream(messages))


class RateLimitedClient:
    """Bricht mitten im Strom mit 429 ab — der Groq-Fall ohne Rückfallebene."""

    name = "fake"
    model = "fake-model"

    def chat_stream(self, messages: list[dict]):
        yield "Angefangene "
        raise httpx.HTTPStatusError(
            "rate limited",
            request=httpx.Request("POST", "https://example.invalid"),
            response=httpx.Response(429),
        )

    def chat(self, messages: list[dict]) -> str:
        return "".join(self.chat_stream(messages))


def _plan_with(llm: object) -> AnswerPlan:
    hit = SearchHit(
        chunk_id="c1",
        document_id="d1",
        title="Attention Is All You Need",
        uri="http://arxiv.org/abs/1706.03762",
        content="self-attention ...",
        heading="Model",
    )
    return AnswerPlan(
        hits=[hit],
        messages=[{"role": "system", "content": "s"}, {"role": "user", "content": "u"}],
        client=llm,
    )


def test_chat_streams_tokens_then_sources(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    plan = _plan_with(FakeClient())
    monkeypatch.setattr("app.api.chat.prepare_answer", lambda *a, **k: plan)

    resp = client.post("/chat", json={"query": "Wie funktioniert Self-Attention?"})
    assert resp.status_code == 200
    body = resp.text
    assert "Self-attention" in body
    assert '"type": "token"' in body
    assert '"type": "sources"' in body
    assert "Attention Is All You Need" in body
    assert '"model": "fake-model"' in body
    assert '"provider": "fake"' in body
    assert "[DONE]" in body


def test_chat_rejects_overlong_query(client: TestClient) -> None:
    resp = client.post("/chat", json={"query": "x" * 5000})
    assert resp.status_code == 422  # exceeds MAX_INPUT_CHARS


def test_chat_reports_provider_error_and_still_closes(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Ein 429 mitten im Strom darf ihn nicht wortlos abreissen (ADR-0021).

    Die Kopfzeilen sind zu diesem Zeitpunkt raus, ein HTTP-Fehler ginge ins Leere.
    Ohne Ereignis und [DONE] wartet der Browser auf Token, die nie kommen.
    """
    plan = _plan_with(RateLimitedClient())
    monkeypatch.setattr("app.api.chat.prepare_answer", lambda *a, **k: plan)

    resp = client.post("/chat", json={"query": "Wie funktioniert Self-Attention?"})
    assert resp.status_code == 200
    body = resp.text
    assert "Angefangene" in body  # bereits gesendete Token bleiben stehen
    assert '"type": "error"' in body
    assert "ausgelastet" in body
    assert '"type": "sources"' in body  # Belege kommen trotzdem
    assert "[DONE]" in body


# ------------------------------------------- Strom endet immer geordnet (L6)


class BrokenFrameClient:
    """Wirft mitten im Strom etwas, das *kein* httpx-Fehler ist.

    Genau der Fall, den ein Anbieter-Rahmen ohne ``choices`` ausgeloest hat:
    vorher fing chat.py nur httpx.HTTPError, der KeyError flog durch und der
    Strom endete ohne sources und ohne [DONE].
    """

    name = "fake"
    model = "fake-model"

    def chat_stream(self, messages: list[dict]):
        yield "Angefangene "
        raise KeyError("choices")

    def chat(self, messages: list[dict]) -> str:
        return "".join(self.chat_stream(messages))


def test_unexpected_stream_error_still_closes_the_stream(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    plan = _plan_with(BrokenFrameClient())
    monkeypatch.setattr("app.api.chat.prepare_answer", lambda *a, **k: plan)

    body = client.post("/chat", json={"query": "Wie funktioniert Self-Attention?"}).text

    assert "Angefangene" in body  # bereits gesendete Token bleiben erhalten
    assert '"type": "error"' in body
    assert '"type": "sources"' in body
    assert body.rstrip().endswith("[DONE]")


def test_sse_frames_without_choices_are_skipped() -> None:
    """Fehlerobjekte, Usage-Rahmen und Keep-Alives duerfen den Strom nicht abreissen."""
    from app.generation.llm import _OpenAICompatChatClient

    frames = [
        'data: {"choices":[{"delta":{"content":"Hallo "}}]}',
        "data: {}",  # Keep-Alive ohne choices
        'data: {"choices":[]}',  # leeres choices
        'data: {"error":{"message":"kaputt"}}',  # Fehlerobjekt des Anbieters
        "data: {nicht json",  # kaputtes JSON
        'data: {"choices":[{"delta":{}}]}',  # Rahmen ohne content
        'data: {"choices":[{"delta":{"content":"Welt"}}]}',
        "data: [DONE]",
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="\n\n".join(frames))

    transport = httpx.MockTransport(handler)
    llm = _OpenAICompatChatClient(
        "k", "m", client=httpx.Client(transport=transport, base_url="https://example.invalid")
    )
    assert "".join(llm.chat_stream([{"role": "user", "content": "x"}])) == "Hallo Welt"
