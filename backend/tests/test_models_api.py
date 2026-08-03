"""GET /models + Ollama tags helper (ADR-0008)."""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

import app.api.models as models_api
from app.core.config import get_settings
from app.generation.llm import _TAGS_CACHE, list_ollama_models

ADMIN_KEY = get_settings().admin_api_key


@pytest.fixture(autouse=True)
def _clear_tags_cache() -> None:
    _TAGS_CACHE.clear()


def _tags_client(handler: httpx.MockTransport) -> httpx.Client:
    return httpx.Client(transport=handler, base_url="http://ollama.test")


def test_list_ollama_models_parses_tags() -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "models": [
                    {
                        "name": "qwen3:8b",
                        "size": 5_200_000_000,
                        "details": {"parameter_size": "8B"},
                    },
                    {"name": "mistral:7b", "size": 4_100_000_000, "details": {}},
                ]
            },
        )

    client = _tags_client(httpx.MockTransport(handle))
    models = list_ollama_models("http://ollama.test", client=client)
    assert models is not None
    assert [m["name"] for m in models] == ["qwen3:8b", "mistral:7b"]
    assert models[0]["parameter_size"] == "8B"


def test_list_ollama_models_none_when_unreachable() -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom")

    client = _tags_client(httpx.MockTransport(handle))
    assert list_ollama_models("http://ollama.test", client=client) is None


def test_list_ollama_models_uses_cache() -> None:
    calls = {"n": 0}

    def handle(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(200, json={"models": [{"name": "qwen3:8b"}]})

    client = _tags_client(httpx.MockTransport(handle))
    list_ollama_models("http://ollama.test", client=client)
    list_ollama_models("http://ollama.test", client=client)
    assert calls["n"] == 1


def test_models_endpoint_requires_admin(client: TestClient) -> None:
    assert client.get("/models").status_code == 401


def test_models_endpoint_reports_availability(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr(models_api, "list_ollama_models", lambda _url: [{"name": "qwen3:8b"}])
    ok = client.get("/models", headers={"X-API-Key": ADMIN_KEY}).json()
    assert ok["available"] is True
    assert ok["models"][0]["name"] == "qwen3:8b"
    assert ok["default"] == get_settings().ollama_llm_model

    monkeypatch.setattr(models_api, "list_ollama_models", lambda _url: None)
    down = client.get("/models", headers={"X-API-Key": ADMIN_KEY}).json()
    assert down["available"] is False
    assert down["models"] == []
