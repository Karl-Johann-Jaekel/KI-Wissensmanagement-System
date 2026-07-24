"""KWMSClient tests against a mocked backend transport (no running server)."""

from __future__ import annotations

import httpx

from mcp_server.client import KWMSClient


def _client(handler, admin_key: str = "") -> KWMSClient:
    http = httpx.Client(base_url="http://backend", transport=httpx.MockTransport(handler))
    return KWMSClient(admin_key=admin_key, client=http)


def test_search_knowledge_compacts_hits() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/search"
        return httpx.Response(
            200,
            json={
                "query": "rag",
                "hits": [
                    {
                        "title": "RAG Paper",
                        "heading": "Method",
                        "uri": "http://arxiv/abs/2005.11401",
                        "sensitivity": "public",
                        "content": "x" * 800,
                        "scores": {},
                    }
                ],
            },
        )

    hits = _client(handler).search_knowledge("rag", top_k=3)
    assert len(hits) == 1
    assert hits[0]["title"] == "RAG Paper"
    assert hits[0]["section"] == "Method"
    assert len(hits[0]["text"]) == 500  # truncated


def test_ask_knowledge_parses_sse() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/chat"
        body = (
            'data: {"type": "token", "text": "Hallo "}\n\n'
            'data: {"type": "token", "text": "Welt"}\n\n'
            'data: {"type": "sources", "sources": [{"title": "P"}]}\n\n'
            "data: [DONE]\n\n"
        )
        return httpx.Response(200, text=body)

    result = _client(handler).ask_knowledge("frage?")
    assert result["answer"] == "Hallo Welt"
    assert result["sources"] == [{"title": "P"}]


def test_list_documents_filters_and_sends_admin_key() -> None:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["key"] = request.headers.get("X-API-Key")
        return httpx.Response(
            200,
            json=[
                {"title": "pub", "sensitivity": "public"},
                {"title": "sec", "sensitivity": "confidential"},
            ],
        )

    docs = _client(handler, admin_key="k").list_documents(sensitivity="confidential")
    assert seen["key"] == "k"
    assert [d["title"] for d in docs] == ["sec"]


def test_query_graph_passes_include_pending() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params.get("include_pending") == "true"
        return httpx.Response(200, json={"nodes": [], "links": []})

    assert _client(handler).query_graph(include_pending=True) == {"nodes": [], "links": []}
