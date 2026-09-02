"""Anreicherung und Ausdünnung der Repo-Knoten.

Der Papers-with-Code-Dump führt keine Sterne; ohne sie ist eine viel genutzte
Referenzimplementierung von einem Nachbau nicht zu unterscheiden.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.db.graph import upsert_edge, upsert_node
from app.db.models import GraphEdge, GraphNode


def _load(name: str):
    kandidaten = [p / "scripts" / f"{name}.py" for p in Path(__file__).resolve().parents[1:3]]
    pfad = next(p for p in kandidaten if p.exists())
    spec = importlib.util.spec_from_file_location(name, pfad)
    assert spec and spec.loader
    modul = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = modul
    spec.loader.exec_module(modul)
    return modul


enrich = _load("enrich_repo_stars")
prune = _load("prune_repos")


@pytest.mark.parametrize(
    ("url", "name", "erwartet"),
    [
        ("https://github.com/pytorch/vision", "pytorch/vision", ("pytorch", "vision")),
        ("https://github.com/owner/repo.git", "owner/repo", ("owner", "repo")),
        ("https://github.com/owner/repo/", "owner/repo", ("owner", "repo")),
        (None, "owner/repo", ("owner", "repo")),  # Rückfall auf den Knotennamen
        ("kaputt", "auch-kaputt", None),
    ],
)
def test_repo_url_parsing(url: str | None, name: str, erwartet) -> None:
    assert enrich.parse_repo(url, name) == erwartet


def test_query_bundles_repos_with_aliases() -> None:
    """Ein Alias je Repo — 50 Repos in einer Abfrage statt 50 Abfragen."""
    q = enrich.build_query([("a", "b"), ("c", "d")])
    assert 'r0: repository(owner: "a", name: "b")' in q
    assert 'r1: repository(owner: "c", name: "d")' in q
    assert q.count("stargazerCount") == 2


def _repo(session: Session, name: str, stars: int | None) -> str:
    meta: dict = {"url": f"https://github.com/{name}"}
    if stars is not None:
        meta["stars"] = stars
    return upsert_node(session, "repo", name, meta)


def test_prune_keeps_popular_and_unmeasured(db_session: Session) -> None:
    """Unter der Schwelle fliegt raus; ohne Sternzahl bleibt unangetastet.

    Was nicht gemessen wurde, wird nicht verworfen — ein Repo ohne Antwort von
    GitHub ist gelöscht oder umbenannt, nicht unbeliebt.
    """
    db_session.execute(text("DELETE FROM graph_nodes"))
    beliebt = _repo(db_session, "pytorch/vision", 17000)
    knapp = _repo(db_session, "someone/almost", 99)
    unbekannt = _repo(db_session, "gone/away", None)
    db_session.commit()

    treffer = prune.auswahl(db_session, min_stars=100, drop_unknown=False)
    ids = {str(n.id) for n in treffer}
    assert ids == {knapp}
    assert beliebt not in ids and unbekannt not in ids


def test_prune_can_drop_unmeasured_on_request(db_session: Session) -> None:
    db_session.execute(text("DELETE FROM graph_nodes"))
    _repo(db_session, "gone/away", None)
    db_session.commit()
    assert len(prune.auswahl(db_session, min_stars=100, drop_unknown=True)) == 1


def test_prune_removes_edges_and_leaves_papers(db_session: Session) -> None:
    db_session.execute(text("DELETE FROM graph_nodes"))
    paper = upsert_node(db_session, "paper", "Ein Paper")
    schwach = _repo(db_session, "someone/weak", 3)
    upsert_edge(db_session, paper, schwach, "IMPLEMENTS")
    db_session.commit()

    treffer = prune.auswahl(db_session, min_stars=100, drop_unknown=False)
    kanten, _belege = prune.entfernen(db_session, treffer)
    db_session.commit()

    assert kanten == 1
    assert db_session.execute(select(GraphEdge)).scalars().all() == []
    # Das Paper bleibt — ausgeduennt werden Repos, nicht Arbeiten.
    verbleibend = db_session.execute(select(GraphNode)).scalars().all()
    assert [n.kind for n in verbleibend] == ["paper"]
