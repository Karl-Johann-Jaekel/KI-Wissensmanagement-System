"""CLI: sync a GitHub user's public repos into the portfolio graph.

    python -m app.sync_github <username>

Idempotent (upserts). Needs GITHUB_TOKEN in the environment / .env (read-only,
public scope). The token is never printed.
"""

from __future__ import annotations

import sys

from app.db.session import SessionLocal
from app.github.extract import store_portfolio
from app.github.sync import fetch_portfolio


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if len(args) != 1:
        print("usage: python -m app.sync_github <github-username>", file=sys.stderr)
        return 2
    username = args[0]

    print(f"Fetching public repos for '{username}' …")
    repos = fetch_portfolio(username)
    print(f"  {len(repos)} repos fetched. Mapping to graph …")

    with SessionLocal() as session:
        stats = store_portfolio(session, repos)
    print(f"Done. repos={stats.repos} node-upserts={stats.nodes} edge-upserts={stats.edges}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
