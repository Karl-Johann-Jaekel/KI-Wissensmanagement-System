# KWMS MCP Server (PLAN §7 Phase 7)

Exposes the knowledge base to Claude (Desktop / Code) via [fastmcp]. Tools call the
backend HTTP API — no direct DB access — so the backend must be running
(`docker compose up -d`).

## Tools
| Tool | Purpose | Zone |
|---|---|---|
| `search_knowledge(query, top_k)` | hybrid search → passages + sources | offen |
| `ask_knowledge(question, top_k)` | cited RAG answer | offen |
| `list_documents(sensitivity?)` | list indexed docs | public unless admin key |
| `query_graph(include_pending?)` | knowledge graph nodes/links | public unless admin key |

Der Graph mit `include_pending=True` verlangt den Admin-Key (`KWMS_ADMIN_KEY`).
`KWMS_ADMIN_KEY`; the backend rejects them otherwise (no leak without the key).

## Run

```bash
pip install fastmcp httpx            # or: uv pip install -e mcp_server
KWMS_API_BASE=http://localhost:8000 python -m mcp_server.server
```

## Claude Desktop / Code integration

Add to `claude_desktop_config.json` (`mcpServers`), then restart Claude:

```json
{
  "mcpServers": {
    "kwms": {
      "command": "python",
      "args": ["-m", "mcp_server.server"],
      "cwd": "C:/Users/kjjae/Desktop/Projekte/KI-Wissensmanagement-System",
      "env": {
        "KWMS_API_BASE": "http://localhost:8000",
        "KWMS_ADMIN_KEY": ""
      }
    }
  }
}
```

Verify by asking Claude e.g. *"use search_knowledge to find passages about RRF"* or
*"ask_knowledge: what is Retrieval-Augmented Generation?"*.
