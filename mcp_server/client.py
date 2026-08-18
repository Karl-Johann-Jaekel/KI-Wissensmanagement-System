"""HTTP client wrapping the KWMS backend API (fastmcp-free, so it is unit-testable).

The MCP tools in ``server.py`` are thin wrappers over these functions. Everything
goes through the backend's HTTP API, so the MCP server needs no DB/model access —
just an API base URL and (optionally) the admin key for confidential/pending data.
"""

from __future__ import annotations

import json
import os
from typing import Any

import httpx

DEFAULT_BASE = "http://localhost:8000"


class KWMSClient:
    def __init__(
        self,
        base_url: str | None = None,
        admin_key: str | None = None,
        *,
        client: httpx.Client | None = None,
    ) -> None:
        self.base_url = base_url or os.environ.get("KWMS_API_BASE", DEFAULT_BASE)
        self.admin_key = (
            admin_key if admin_key is not None else os.environ.get("KWMS_ADMIN_KEY", "")
        )
        self._client = client or httpx.Client(base_url=self.base_url, timeout=120.0)

    def _headers(self) -> dict[str, str]:
        return {"X-API-Key": self.admin_key} if self.admin_key else {}

    def search_knowledge(self, query: str, top_k: int = 5) -> list[dict[str, Any]]:
        """Hybrid search over the corpus; returns compact passages with sources."""
        resp = self._client.post(
            "/search",
            json={"query": query, "top_k": top_k},
            headers=self._headers(),
        )
        resp.raise_for_status()
        hits = resp.json()["hits"]
        return [
            {
                "title": h["title"],
                "section": h.get("heading"),
                "uri": h.get("uri"),
                "text": h["content"][:500],
            }
            for h in hits
        ]

    def ask_knowledge(self, question: str, top_k: int = 5) -> dict[str, Any]:
        """RAG answer with citations (consumes the /chat SSE stream)."""
        answer: list[str] = []
        sources: list[dict] = []
        with self._client.stream(
            "POST",
            "/chat",
            json={"query": question, "top_k": top_k},
            headers=self._headers(),
        ) as resp:
            resp.raise_for_status()
            for line in resp.iter_lines():
                if not line or not line.startswith("data:"):
                    continue
                payload = line[len("data:") :].strip()
                if payload == "[DONE]":
                    break
                event = json.loads(payload)
                if event.get("type") == "token":
                    answer.append(event.get("text", ""))
                elif event.get("type") == "sources":
                    sources = event.get("sources", [])
        return {"answer": "".join(answer), "sources": sources}

    def list_documents(self) -> list[dict[str, Any]]:
        """List indexed documents (admin key returns confidential too)."""
        resp = self._client.get("/documents", headers=self._headers())
        resp.raise_for_status()
        docs = resp.json()
        return docs

    def query_graph(self, include_pending: bool = False) -> dict[str, Any]:
        """Knowledge graph nodes/links (paper/concept/model/dataset)."""
        resp = self._client.get(
            "/graph",
            params={"include_pending": str(include_pending).lower()},
            headers=self._headers(),
        )
        resp.raise_for_status()
        return resp.json()
