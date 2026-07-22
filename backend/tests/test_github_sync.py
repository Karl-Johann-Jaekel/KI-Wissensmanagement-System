"""GitHubClient tests against a mocked transport (no network)."""

from __future__ import annotations

import base64
import json

import httpx

from app.github.sync import API, GitHubClient, fetch_portfolio


def _b64(text: str) -> str:
    return base64.b64encode(text.encode()).decode()


def _repo(name: str, *, fork: bool = False) -> dict:
    return {
        "name": name,
        "full_name": f"octo/{name}",
        "description": f"{name} desc",
        "html_url": f"https://github.com/octo/{name}",
        "topics": ["rag", "knowledge-graph"],
        "stargazers_count": 3,
        "archived": False,
        "fork": fork,
    }


def _make_client(handler) -> GitHubClient:
    transport = httpx.MockTransport(handler)
    http = httpx.Client(base_url=API, transport=transport)
    return GitHubClient(token="x", client=http)


def test_list_repos_paginates_and_filters_forks() -> None:
    page1 = [_repo(f"r{i}") for i in range(100)]
    page2 = [_repo("last"), _repo("aFork", fork=True)]

    def handler(request: httpx.Request) -> httpx.Response:
        page = int(request.url.params.get("page", "1"))
        body = page1 if page == 1 else page2 if page == 2 else []
        return httpx.Response(200, json=body)

    with _make_client(handler) as gh:
        repos = gh.list_repos("octo")
    names = [r["name"] for r in repos]
    assert len(repos) == 101  # 100 + 1, fork removed
    assert "aFork" not in names


def test_etag_conditional_replays_cached_body() -> None:
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if request.headers.get("If-None-Match") == 'W/"abc"':
            return httpx.Response(304)
        return httpx.Response(200, json=[_repo("r1")], headers={"ETag": 'W/"abc"'})

    store: dict = {}
    with _make_client(handler) as gh:
        gh._cache = store
        first = gh.list_repos("octo")
        second = gh.list_repos("octo")  # sends If-None-Match -> 304 -> cached body

    assert first == second
    assert [r["name"] for r in first] == ["r1"]
    assert calls["n"] >= 2  # both requests actually hit the transport


def test_get_file_404_returns_none() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"message": "Not Found"})

    with _make_client(handler) as gh:
        assert gh.get_file("octo/x", "package.json") is None


def test_fetch_repo_assembles_everything() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/languages"):
            return httpx.Response(200, json={"Python": 800, "TypeScript": 200})
        if path.endswith("/readme"):
            return httpx.Response(200, json={"encoding": "base64", "content": _b64("# Hello")})
        if "/contents/pyproject.toml" in path:
            toml = '[project]\ndependencies = ["fastapi>=0.115"]\n'
            return httpx.Response(200, json={"encoding": "base64", "content": _b64(toml)})
        if "/contents/" in path:
            return httpx.Response(404, json={})
        return httpx.Response(200, json=[])

    with _make_client(handler) as gh:
        data = gh.fetch_repo(_repo("demo"))

    assert data.languages == {"Python": 800, "TypeScript": 200}
    assert data.readme == "# Hello"
    assert "pyproject.toml" in data.manifests
    assert "package.json" not in data.manifests  # 404
    assert data.topics == ["rag", "knowledge-graph"]


def test_fetch_portfolio_end_to_end() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/repos"):
            page = int(request.url.params.get("page", "1"))
            return httpx.Response(200, json=[_repo("demo")] if page == 1 else [])
        if path.endswith("/languages"):
            return httpx.Response(200, json={"Python": 100})
        if path.endswith("/readme"):
            return httpx.Response(404, json={})
        return httpx.Response(404, json={})

    with _make_client(handler) as gh:
        repos = fetch_portfolio("octo", client=gh)
    assert len(repos) == 1
    assert repos[0].languages == {"Python": 100}
    assert json.dumps(repos[0].topics)  # serialisable
