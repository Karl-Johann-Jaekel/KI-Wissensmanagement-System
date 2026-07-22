"""/chat SSE streaming with a fake LLM client (no DB / no Ollama)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.generation.generate import AnswerPlan
from app.retrieval.search import SearchHit


class FakeClient:
    name = "fake"

    def chat_stream(self, messages: list[dict]):
        yield "Self-attention "
        yield "relates positions [Attention, Model]."

    def chat(self, messages: list[dict]) -> str:
        return "".join(self.chat_stream(messages))


def test_chat_streams_tokens_then_sources(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    hit = SearchHit(
        chunk_id="c1",
        document_id="d1",
        title="Attention Is All You Need",
        uri="http://arxiv.org/abs/1706.03762",
        sensitivity="public",
        content="self-attention ...",
        heading="Model",
    )
    plan = AnswerPlan(
        hits=[hit],
        messages=[{"role": "system", "content": "s"}, {"role": "user", "content": "u"}],
        client=FakeClient(),
        zone="public",
    )
    monkeypatch.setattr("app.api.chat.prepare_answer", lambda *a, **k: plan)

    resp = client.post("/chat", json={"query": "Wie funktioniert Self-Attention?"})
    assert resp.status_code == 200
    body = resp.text
    assert "Self-attention" in body
    assert '"type": "token"' in body
    assert '"type": "sources"' in body
    assert "Attention Is All You Need" in body
    assert "[DONE]" in body


def test_chat_rejects_overlong_query(client: TestClient) -> None:
    resp = client.post("/chat", json={"query": "x" * 5000})
    assert resp.status_code == 422  # exceeds MAX_INPUT_CHARS
