"""fastmcp server exposing the KWMS knowledge base to Claude (PLAN §7 Phase 7).

Run (from the repo root):
    KWMS_API_BASE=http://localhost:8000 python -m mcp_server.server

Der Korpus ist vollständig öffentlich (ADR-0015). KWMS_ADMIN_KEY braucht nur, wer
über ``query_graph(include_pending=True)`` die ungeprüften Fakten sehen will — das
Backend erzwingt das, ohne Schlüssel kommt nichts Unbestätigtes heraus.
"""

from __future__ import annotations

from typing import Any

from fastmcp import FastMCP

from mcp_server.client import KWMSClient

mcp: FastMCP = FastMCP("kwms")
_client = KWMSClient()


@mcp.tool()
def search_knowledge(query: str, top_k: int = 5) -> list[dict[str, Any]]:
    """Hybrid (vector + keyword) search over the AI-research corpus.

    Returns the top passages with their source paper, section and a text preview.
    """
    return _client.search_knowledge(query, top_k)


@mcp.tool()
def ask_knowledge(question: str, top_k: int = 5) -> dict[str, Any]:
    """Ask a question and get a cited answer grounded in the corpus.

    Returns {"answer": str, "sources": [...]}. Answers only from retrieved context.
    """
    return _client.ask_knowledge(question, top_k)


@mcp.tool()
def list_documents() -> list[dict[str, Any]]:
    """List indexed documents (title, type, zone, chunk count).

    Without the admin key only public documents are returned.
    """
    return _client.list_documents()


@mcp.tool()
def query_graph(include_pending: bool = False) -> dict[str, Any]:
    """Return the knowledge graph (paper/concept/model/dataset) as {nodes, links}.

    ``include_pending=true`` (admin) also returns unverified facts from the
    living-knowledge extraction (Phase 8).
    """
    return _client.query_graph(include_pending)


if __name__ == "__main__":
    mcp.run()
