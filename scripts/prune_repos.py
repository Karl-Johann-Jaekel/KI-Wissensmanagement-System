"""Wenig beachtete Code-Repos aus dem Graphen nehmen.

Aus dem Papers-with-Code-Import stammen 4.717 Repo-Knoten. 4.437 davon hängen an
genau einer Kante: sie verbinden nichts, sie hängen an einem Paper. Nur 21
berühren überhaupt den eigenen Korpus. Als Wissen tragen sie wenig — als Rauschen
machen sie ein Drittel des Graphen aus.

Die Sternzahl trennt die Referenzimplementierung vom Nachbau. Sie muss vorher
geholt werden:

    python scripts/enrich_repo_stars.py
    python scripts/prune_repos.py --min-stars 100          # Trockenlauf
    python scripts/prune_repos.py --min-stars 100 --apply  # nach Backup

Repos **ohne** Sternzahl (gelöscht, umbenannt, nie abgefragt) werden nicht
angefasst — was nicht gemessen wurde, wird nicht verworfen. Wer sie mitnehmen
will, nutzt ``--drop-unknown``.
"""

from __future__ import annotations

import argparse
import sys

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import EntityExtraction, GraphEdge, GraphNode
from app.db.session import SessionLocal


def auswahl(session: Session, *, min_stars: int, drop_unknown: bool) -> list[GraphNode]:
    """Repo-Knoten unterhalb der Schwelle."""
    nodes = session.execute(select(GraphNode).where(GraphNode.kind == "repo")).scalars().all()
    treffer = []
    for n in nodes:
        sterne = (n.meta or {}).get("stars")
        if sterne is None:
            if drop_unknown:
                treffer.append(n)
            continue
        if int(sterne) < min_stars:
            treffer.append(n)
    return treffer


def entfernen(session: Session, nodes: list[GraphNode]) -> tuple[int, int]:
    """Knoten samt Kanten und Belegen löschen. Gibt (Kanten, Belege)."""
    ids = [n.id for n in nodes]
    if not ids:
        return 0, 0
    kanten = (
        session.execute(
            select(GraphEdge).where((GraphEdge.source.in_(ids)) | (GraphEdge.target.in_(ids)))
        )
        .scalars()
        .all()
    )
    belege = (
        session.execute(select(EntityExtraction).where(EntityExtraction.node_id.in_(ids)))
        .scalars()
        .all()
    )
    for e in kanten:
        session.delete(e)
    for b in belege:
        session.delete(b)
    session.flush()
    for n in nodes:
        session.delete(n)
    return len(kanten), len(belege)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--min-stars", type=int, default=100)
    parser.add_argument("--apply", action="store_true", help="wirklich löschen (Backup!)")
    parser.add_argument(
        "--drop-unknown",
        action="store_true",
        help="auch Repos ohne Sternzahl entfernen (Vorgabe: behalten)",
    )
    args = parser.parse_args(argv)

    with SessionLocal() as session:
        alle = session.execute(select(GraphNode).where(GraphNode.kind == "repo")).scalars().all()
        ohne_zahl = sum(1 for n in alle if (n.meta or {}).get("stars") is None)
        treffer = auswahl(session, min_stars=args.min_stars, drop_unknown=args.drop_unknown)
        bleiben = len(alle) - len(treffer)

        print(f"Repos gesamt: {len(alle)}  ·  ohne Sternzahl: {ohne_zahl}")
        print(f"Schwelle: {args.min_stars} Sterne")
        print(f"  entfernen: {len(treffer)}")
        print(f"  behalten : {bleiben}")

        beispiele = sorted(
            (n for n in alle if n not in treffer and (n.meta or {}).get("stars") is not None),
            key=lambda n: -int(n.meta["stars"]),
        )[:8]
        if beispiele:
            print("\nDie bestbewerteten, die bleiben:")
            for n in beispiele:
                print(f"  {n.meta['stars']:>7} ★  {n.name}")

        if not args.apply:
            print("\nTrockenlauf — nichts geschrieben. Mit --apply ausführen (vorher Backup).")
            return 0

        kanten, belege = entfernen(session, treffer)
        session.commit()
        print(f"\n{len(treffer)} Repos entfernt, dazu {kanten} Kanten und {belege} Belege.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
