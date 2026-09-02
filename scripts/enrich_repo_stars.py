"""Repo-Knoten mit ihrer Sternzahl anreichern (GitHub GraphQL).

Der Papers-with-Code-Dump führt keine Sterne — ohne sie lässt sich nicht
unterscheiden, ob ein Code-Repo eine viel genutzte Referenzimplementierung ist
oder ein Nachbau, den nie jemand geöffnet hat. Von 4.717 Repos hängen 4.437 an
genau einer Kante; die Sternzahl ist das Signal, das sie sortierbar macht.

    docker compose exec -T backend python scripts/enrich_repo_stars.py --limit 50
    docker compose exec -T backend python scripts/enrich_repo_stars.py

Braucht ``GITHUB_TOKEN`` in der Umgebung (ein Token ohne Rechte genügt, es werden
nur öffentliche Zahlen gelesen). Ohne Token erlaubt GitHub 60 Abfragen je Stunde
— bei 4.717 Repos wären das 79 Stunden.

GraphQL statt REST, weil sich damit 50 Repos in einer Abfrage bündeln lassen:
rund 95 Abfragen statt 4.717. Ein Repo, das es nicht mehr gibt, bekommt
``stars: null`` statt eines Abbruchs — gelöschte und umbenannte Repos sind bei
einem Dump von 2026 der Normalfall, kein Fehler.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import UTC, datetime
from urllib.parse import urlparse

import httpx
from sqlalchemy import select
from sqlalchemy.orm import attributes

from app.db.models import GraphNode
from app.db.session import SessionLocal

GITHUB_GRAPHQL = "https://api.github.com/graphql"

#: Repos je Abfrage. 50 ist konservativ — GitHub deckelt die Komplexität einer
#: Abfrage, nicht nur ihre Zahl.
BATCH = 50

#: Abfragen sind teuer genug, um sie nicht zu wiederholen: Ergebnisse landen in
#: ``meta.stars`` samt Abrufdatum, ein zweiter Lauf überspringt Bekanntes.
META_STARS = "stars"
META_FETCHED = "stars_fetched_at"


def parse_repo(url: str | None, name: str) -> tuple[str, str] | None:
    """``owner``/``repo`` aus der URL lesen; der Knotenname dient als Rückfall."""
    for kandidat in (url, name):
        if not kandidat:
            continue
        pfad = urlparse(kandidat).path if "://" in kandidat else kandidat
        teile = [t for t in pfad.strip("/").removesuffix(".git").split("/") if t]
        if len(teile) >= 2:
            return teile[-2], teile[-1]
    return None


def build_query(repos: list[tuple[str, str]]) -> str:
    """Eine Abfrage mit einem Alias je Repo — GitHub beantwortet sie in einem Zug."""
    felder = "\n".join(
        f'  r{i}: repository(owner: "{owner}", name: "{name}") {{ stargazerCount }}'
        for i, (owner, name) in enumerate(repos)
    )
    return "query {\n" + felder + "\n}"


def fetch_stars(
    client: httpx.Client, repos: list[tuple[str, str]], *, sleep: float = 0.0
) -> dict[int, int | None]:
    """Sternzahlen je Position. ``None`` heißt: von GitHub nicht beantwortet."""
    response = client.post(GITHUB_GRAPHQL, json={"query": build_query(repos)})
    if response.status_code in (403, 429):
        # Sekundäres Limit: GitHub nennt die Wartezeit selbst, wenn es kann.
        wartezeit = float(response.headers.get("retry-after", 60))
        print(f"  Limit erreicht, warte {wartezeit:.0f}s")
        time.sleep(wartezeit if sleep == 0 else sleep)
        response = client.post(GITHUB_GRAPHQL, json={"query": build_query(repos)})
    response.raise_for_status()
    daten = response.json().get("data") or {}
    ergebnis: dict[int, int | None] = {}
    for i in range(len(repos)):
        eintrag = daten.get(f"r{i}")
        ergebnis[i] = eintrag.get("stargazerCount") if isinstance(eintrag, dict) else None
    return ergebnis


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=None, help="nur die ersten N Repos")
    parser.add_argument("--refresh", action="store_true", help="auch bereits bekannte neu holen")
    args = parser.parse_args(argv)

    token = os.environ.get("GITHUB_TOKEN", "").strip()
    if not token:
        print("GITHUB_TOKEN fehlt — ohne Token erlaubt GitHub 60 Abfragen je Stunde.")
        return 2

    with SessionLocal() as session:
        nodes = (
            session.execute(select(GraphNode).where(GraphNode.kind == "repo")).scalars().all()
        )
        offen = [
            n for n in nodes if args.refresh or META_STARS not in (n.meta or {})
        ]
        if args.limit:
            offen = offen[: args.limit]
        print(f"{len(offen)} von {len(nodes)} Repos abzufragen")
        if not offen:
            return 0

        client = httpx.Client(
            headers={"Authorization": f"Bearer {token}"},
            timeout=60.0,
        )
        jetzt = datetime.now(UTC).isoformat()
        gefunden = fehlend = 0
        try:
            for start in range(0, len(offen), BATCH):
                stapel = offen[start : start + BATCH]
                paare: list[tuple[str, str]] = []
                zuordnung: list[GraphNode] = []
                for node in stapel:
                    zerlegt = parse_repo((node.meta or {}).get("url"), node.name)
                    if zerlegt:
                        paare.append(zerlegt)
                        zuordnung.append(node)
                if not paare:
                    continue

                sterne = fetch_stars(client, paare)
                for i, node in enumerate(zuordnung):
                    wert = sterne.get(i)
                    node.meta = {**(node.meta or {}), META_STARS: wert, META_FETCHED: jetzt}
                    attributes.flag_modified(node, "meta")
                    if wert is None:
                        fehlend += 1
                    else:
                        gefunden += 1
                session.commit()
                fortschritt = f"{start + len(stapel):>5}/{len(offen)}"
                print(f"  {fortschritt}  gefunden {gefunden}, ohne Antwort {fehlend}")
        finally:
            client.close()

        print(f"\nFertig: {gefunden} mit Sternzahl, {fehlend} ohne Antwort (gelöscht/umbenannt).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
