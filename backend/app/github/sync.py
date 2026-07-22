"""GitHub REST sync — fetch public repos, topics, languages, README, manifests.

Read-only, public scope only (PLAN §1, Track A). Uses conditional requests
(ETag / If-None-Match) to stay friendly with GitHub's rate limits (PLAN §11).
This module only *fetches*; the rule-based mapping to graph nodes/edges lives in
``github/extract.py``.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass, field
from typing import Any

import httpx

from app.core.config import get_settings

API = "https://api.github.com"
MANIFEST_PATHS = ("package.json", "pyproject.toml", "requirements.txt")


@dataclass
class RepoData:
    name: str
    full_name: str
    description: str | None
    html_url: str
    topics: list[str] = field(default_factory=list)
    languages: dict[str, int] = field(default_factory=dict)
    stars: int = 0
    archived: bool = False
    fork: bool = False
    readme: str | None = None
    manifests: dict[str, str] = field(default_factory=dict)


class GitHubClient:
    """Thin GitHub REST client with an injectable ETag store for conditional GETs."""

    def __init__(
        self,
        token: str | None = None,
        *,
        client: httpx.Client | None = None,
        etag_store: dict[str, dict[str, Any]] | None = None,
    ) -> None:
        token = token if token is not None else get_settings().github_token
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "ki-wissensmanagement-system (portfolio sync)",
        }
        if token:
            headers["Authorization"] = f"Bearer {token}"
        self._client = client or httpx.Client(base_url=API, headers=headers, timeout=30.0)
        self._owns_client = client is None
        # cache_key -> {"etag": str, "json": Any}; replays body on a 304.
        self._cache = etag_store if etag_store is not None else {}

    def __enter__(self) -> GitHubClient:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def _request(self, path: str, *, params: dict[str, str | int] | None = None) -> tuple[int, Any]:
        """Conditional GET. Returns (status, json). On 304 replays cached body;
        on 404 returns (404, None). Raises for other error statuses."""
        cache_key = path + (f"?{sorted(params.items())}" if params else "")
        headers = {}
        entry = self._cache.get(cache_key)
        if entry is not None:
            headers["If-None-Match"] = entry["etag"]
        resp = self._client.get(path, params=params, headers=headers)
        if resp.status_code == 304:
            return 304, entry["json"] if entry else None
        if resp.status_code == 404:
            return 404, None
        resp.raise_for_status()
        data = resp.json()
        if "ETag" in resp.headers:
            self._cache[cache_key] = {"etag": resp.headers["ETag"], "json": data}
        return resp.status_code, data

    def list_repos(self, username: str, *, include_forks: bool = False) -> list[dict]:
        """All public repos for a user, paginated."""
        repos: list[dict] = []
        page = 1
        while True:
            _, batch = self._request(
                f"/users/{username}/repos",
                params={"per_page": 100, "page": page, "sort": "updated", "type": "owner"},
            )
            if not batch:
                break
            repos.extend(batch)
            if len(batch) < 100:
                break
            page += 1
        if not include_forks:
            repos = [r for r in repos if not r.get("fork")]
        return repos

    def get_languages(self, full_name: str) -> dict[str, int]:
        _, data = self._request(f"/repos/{full_name}/languages")
        return data or {}

    def _decode_content(self, payload: Any) -> str | None:
        if not isinstance(payload, dict):  # e.g. directory listing
            return None
        if payload.get("encoding") == "base64":
            return base64.b64decode(payload["content"]).decode("utf-8", errors="replace")
        return payload.get("content")

    def get_readme(self, full_name: str) -> str | None:
        status, payload = self._request(f"/repos/{full_name}/readme")
        return None if status == 404 else self._decode_content(payload)

    def get_file(self, full_name: str, path: str) -> str | None:
        status, payload = self._request(f"/repos/{full_name}/contents/{path}")
        return None if status == 404 else self._decode_content(payload)

    def fetch_repo(self, repo: dict) -> RepoData:
        """Enrich a repo listing with languages, README and manifests."""
        full = repo["full_name"]
        manifests = {}
        for path in MANIFEST_PATHS:
            content = self.get_file(full, path)
            if content is not None:
                manifests[path] = content
        return RepoData(
            name=repo["name"],
            full_name=full,
            description=repo.get("description"),
            html_url=repo["html_url"],
            topics=repo.get("topics", []),
            languages=self.get_languages(full),
            stars=repo.get("stargazers_count", 0),
            archived=repo.get("archived", False),
            fork=repo.get("fork", False),
            readme=self.get_readme(full),
            manifests=manifests,
        )


def fetch_portfolio(username: str, *, client: GitHubClient | None = None) -> list[RepoData]:
    """Fetch and enrich all public repos for a user (Track A portfolio source)."""
    own = client or GitHubClient()
    try:
        return [own.fetch_repo(r) for r in own.list_repos(username)]
    finally:
        if client is None:
            own.close()
