"""Export the graph(s) to a static JSON file.

Fallback so the frontend can render on GitHub Pages without a backend (PLAN §7
Phase 2). Run inside the backend environment (needs DB access):

    python scripts/export_graph_json.py [output_path]

Writes {"portfolio": {...}, "knowledge": {...}} — the shape api.ts expects as its
offline fallback.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from app.api.graph import get_graph
from app.db.session import SessionLocal


def main(out: str = "frontend/public/graph.json") -> int:
    with SessionLocal() as session:
        data = {
            scope: get_graph(scope=scope, include_pending=False, db=session)
            for scope in ("portfolio", "knowledge")
        }
    path = Path(out)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    p, k = data["portfolio"], data["knowledge"]
    print(
        f"wrote {out}: portfolio {len(p['nodes'])} nodes / {len(p['links'])} links, "
        f"knowledge {len(k['nodes'])} nodes"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(*sys.argv[1:]))
