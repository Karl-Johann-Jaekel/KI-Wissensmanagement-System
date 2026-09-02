"""Knoten zusammenführen, die sich nur in der Knotenart unterscheiden.

Die Identität eines Knotens ist ``UNIQUE(kind, name)`` — die Art gehört also zum
Schlüssel. Leiten zwei Extraktionen dieselbe Sache verschieden ab, entstehen zwei
Knoten: „BERT" liegt als ``concept`` **und** als ``model`` im Graphen. Die Belege
verteilen sich damit auf beide, und die Regel „mindestens N unabhängige Quellen"
greift bei keinem von beiden. Genau das beschreibt die README als Grund dafür, dass
nur ein Bruchteil der Knoten mehrfach belegt ist.

Aufruf (schreibt nichts):

    docker compose exec -T backend python scripts/merge_duplicate_kinds.py

Erst mit ``--apply`` wird geschrieben — **vorher ein Backup ziehen**
(``scripts/backup.sh``), der Schritt ist nicht umkehrbar.

Zusammengeführt wird auf die Art mit den meisten Belegen; bei Gleichstand
entscheidet der Vernetzungsgrad, dann eine feste Rangfolge. Der unterlegene Knoten
wird nicht gelöscht: er behält seine Zeile, bekommt ``meta.merged_into`` und den
Status ``rejected``. Das hält ihn aus dem öffentlichen Graphen und aus der
Promotion heraus, ohne Geschichte wegzuwerfen — und seit dem Fix für verworfene
Knoten hängt auch kein neuer Lauf mehr Kanten daran.
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from dataclasses import dataclass, field

from sqlalchemy import func, select
from sqlalchemy.orm import Session, attributes

from app.corpus.aliases import canonical_key
from app.db.graph import upsert_edge
from app.db.models import EntityExtraction, GraphEdge, GraphNode
from app.db.session import SessionLocal

#: Bei Gleichstand: welche Art gilt als die spezifischere. Ein Modell ist eine
#: konkretere Aussage als ein Konzept, ein Datensatz konkreter als eine Aufgabe.
KIND_PRIORITY = ("model", "dataset", "repo", "task", "concept", "technology", "domain")


@dataclass
class MergePlan:
    winner: GraphNode
    losers: list[GraphNode] = field(default_factory=list)


def _evidence_counts(session: Session) -> dict[str, int]:
    rows = session.execute(
        select(EntityExtraction.node_id, func.count())
        .where(EntityExtraction.node_id.is_not(None))
        .group_by(EntityExtraction.node_id)
    )
    return {str(node_id): int(n) for node_id, n in rows}


def _degrees(session: Session) -> dict[str, int]:
    degrees: dict[str, int] = defaultdict(int)
    for source, target in session.execute(select(GraphEdge.source, GraphEdge.target)):
        degrees[str(source)] += 1
        degrees[str(target)] += 1
    return degrees


def plan_merges(session: Session) -> list[MergePlan]:
    """Gruppen gleicher Sache unter verschiedenen Arten finden."""
    nodes = session.execute(select(GraphNode)).scalars().all()
    evidence = _evidence_counts(session)
    degrees = _degrees(session)

    groups: dict[str, list[GraphNode]] = defaultdict(list)
    for node in nodes:
        if node.kind == "paper":  # Papers sind keine Entitaeten, nichts zu vereinen
            continue
        key = canonical_key(node.name)
        if key:
            groups[key].append(node)

    plans: list[MergePlan] = []
    for members in groups.values():
        if len({n.kind for n in members}) < 2:
            continue

        def rank(node: GraphNode) -> tuple[int, int, int]:
            priority = (
                KIND_PRIORITY.index(node.kind) if node.kind in KIND_PRIORITY else len(KIND_PRIORITY)
            )
            return (-evidence.get(str(node.id), 0), -degrees.get(str(node.id), 0), priority)

        ordered = sorted(members, key=rank)
        plans.append(MergePlan(winner=ordered[0], losers=ordered[1:]))
    return plans


def apply_merge(session: Session, plan: MergePlan) -> tuple[int, int]:
    """Kanten und Belege auf den Zielknoten umhängen. Gibt (Kanten, Belege)."""
    winner_id = plan.winner.id
    moved_edges = moved_evidence = 0

    for loser in plan.losers:
        incident = (
            session.execute(
                select(GraphEdge).where(
                    (GraphEdge.source == loser.id) | (GraphEdge.target == loser.id)
                )
            )
            .scalars()
            .all()
        )
        for edge in incident:
            new_source = winner_id if edge.source == loser.id else edge.source
            new_target = winner_id if edge.target == loser.id else edge.target
            if new_source == new_target:
                # Eine Kante auf sich selbst sagt nichts; ihre Belege gehen per
                # ON DELETE CASCADE mit.
                session.delete(edge)
                continue

            # `entities_extracted` verweist per Fremdschlüssel auf das Tripel
            # (source, target, relation) — ohne ON UPDATE CASCADE. Die Kante
            # umzuschreiben ist deshalb gesperrt, solange Belege daran hängen.
            # Reihenfolge: Zielkante anlegen, Belege umhängen, alte Kante löschen.
            upsert_edge(
                session,
                new_source,
                new_target,
                edge.relation,
                weight=edge.weight,
                meta=edge.meta or {},
                status=edge.status,
            )
            session.flush()

            old_claim = (edge.source, edge.target, edge.relation)
            new_claim = (new_source, new_target, edge.relation)
            existing = {
                (r.document_id, r.source_id, r.extractor)
                for r in session.execute(
                    select(EntityExtraction).where(
                        EntityExtraction.edge_source == new_source,
                        EntityExtraction.edge_target == new_target,
                        EntityExtraction.edge_relation == edge.relation,
                    )
                ).scalars()
            }
            for row in (
                session.execute(
                    select(EntityExtraction).where(
                        EntityExtraction.edge_source == old_claim[0],
                        EntityExtraction.edge_target == old_claim[1],
                        EntityExtraction.edge_relation == old_claim[2],
                    )
                )
                .scalars()
                .all()
            ):
                key = (row.document_id, row.source_id, row.extractor)
                if key in existing:
                    session.delete(row)
                    continue
                row.edge_source, row.edge_target, row.edge_relation = new_claim
                existing.add(key)
                moved_evidence += 1
            session.flush()
            session.delete(edge)
            session.flush()
            moved_edges += 1

        winner_claims = {
            (r.document_id, r.source_id, r.extractor)
            for r in session.execute(
                select(EntityExtraction).where(EntityExtraction.node_id == winner_id)
            ).scalars()
        }
        for row in (
            session.execute(select(EntityExtraction).where(EntityExtraction.node_id == loser.id))
            .scalars()
            .all()
        ):
            claim_key = (row.document_id, row.source_id, row.extractor)
            if claim_key in winner_claims:
                session.delete(row)
                continue
            row.node_id = winner_id
            winner_claims.add(claim_key)
            moved_evidence += 1

        loser.meta = {**(loser.meta or {}), "merged_into": str(winner_id)}
        attributes.flag_modified(loser, "meta")
        loser.status = "rejected"
        session.flush()

    return moved_edges, moved_evidence


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="wirklich schreiben (Backup!)")
    parser.add_argument("--limit", type=int, default=None, help="nur die ersten N Gruppen")
    args = parser.parse_args(argv)

    with SessionLocal() as session:
        plans = plan_merges(session)
        if args.limit:
            plans = plans[: args.limit]

        print(f"{len(plans)} Gruppe(n) mit derselben Sache unter verschiedenen Arten\n")
        for plan in plans[:40]:
            losers = ", ".join(f"{n.name!r} ({n.kind})" for n in plan.losers)
            print(f"  {plan.winner.name!r} ({plan.winner.kind})  <-  {losers}")
        if len(plans) > 40:
            print(f"  … und {len(plans) - 40} weitere")

        if not args.apply:
            print("\nTrockenlauf — nichts geschrieben. Mit --apply ausführen (vorher Backup).")
            return 0

        edges = evidence = 0
        for plan in plans:
            e, v = apply_merge(session, plan)
            edges += e
            evidence += v
        session.commit()
        moved = f"{edges} Kanten, {evidence} Belege umgehängt"
        print(f"\n{len(plans)} Gruppen zusammengeführt: {moved}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
