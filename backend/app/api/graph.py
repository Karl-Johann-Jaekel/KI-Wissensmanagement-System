"""GET /graph — knowledge graph (papers/concepts/models/datasets) for react-force-graph.

Public view shows only ``verified`` facts; ``include_pending=true`` (Review-Queue,
Phase 8) also returns pending ones. ``val`` is the summed incident edge weight so the
frontend can size nodes.

Die Abfrage laeuft in drei Schritten, damit der oeffentliche Endpunkt nicht den
halben Graphen durch Python zieht: erst die Kennzahlen der infrage kommenden Knoten
(ohne JSONB-``meta``), dann die Kanten *zwischen* genau diesen Knoten, und die
vollen Knotenzeilen erst fuer die Auswahl, die tatsaechlich ausgeliefert wird.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import NamedTuple

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import ColumnElement, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.http import no_store, public_cache
from app.core.security import rate_limit, require_admin
from app.db.models import GraphEdge, GraphNode
from app.db.session import get_db

router = APIRouter(tags=["graph"])

# ``repo``/``task`` kommen aus dem Papers-with-Code-Import (ADR-0017).
KNOWLEDGE_KINDS = ("paper", "concept", "model", "dataset", "task", "repo")

#: Obergrenze der ausgelieferten Knoten. Der PwC-Dump kann den Graphen auf
#: Zehntausende Knoten heben; ungebremst friert das die Force-Simulation ein.
DEFAULT_NODE_LIMIT = 2000


class NodeRef(NamedTuple):
    """Knoten ohne ``meta`` — genug zum Ranken und Kappen, ein Bruchteil der Bytes."""

    id: uuid.UUID
    kind: str
    name: str


def _cap_by_kind(nodes: Sequence[NodeRef], val: dict[str, float], limit: int) -> list[NodeRef]:
    """Auf ``limit`` Knoten kappen, ohne eine Knotenart auszulöschen.

    Rein nach Vernetzungsgrad zu kappen bevorzugt strukturell die Naben: Nach dem
    Papers-with-Code-Import überlebten von 4.600 Code-Repos genau zwei, weil ein Repo
    per Definition an genau einem Paper hängt. Jede Art bekommt deshalb ein Kontingent
    im Verhältnis ihres Bestands (mindestens eines) und füllt es mit ihren
    bestvernetzten Knoten; ungenutzte Plätze gehen an den Rest nach Grad.
    """
    by_kind: dict[str, list[NodeRef]] = defaultdict(list)
    for node in nodes:
        by_kind[node.kind].append(node)

    def rank(node: NodeRef) -> tuple[float, str]:
        return (-val.get(str(node.id), 0.0), node.name)

    keep: list[NodeRef] = []
    leftovers: list[NodeRef] = []
    for kind_nodes in by_kind.values():
        quota = max(1, round(limit * len(kind_nodes) / len(nodes)))
        ranked = sorted(kind_nodes, key=rank)
        keep.extend(ranked[:quota])
        leftovers.extend(ranked[quota:])

    if len(keep) > limit:
        keep = sorted(keep, key=rank)[:limit]
    elif len(keep) < limit:
        keep.extend(sorted(leftovers, key=rank)[: limit - len(keep)])
    return keep


@router.get("/graph", dependencies=[Depends(rate_limit)])
def get_graph(
    request: Request,
    response: Response,
    include_pending: bool = Query(default=False, description="also return pending facts"),
    source: str | None = Query(
        default=None,
        description="filter by meta.provenance.source, e.g. paperswithcode; 'native' = ohne",
    ),
    limit: int = Query(default=DEFAULT_NODE_LIMIT, ge=1, le=20000),
    db: Session = Depends(get_db),
) -> dict[str, list[dict]]:
    if include_pending:
        # pending = ungeprüfte LLM-Extraktion — nur Admin (schließt bisherigen Leak).
        require_admin(request)

    conds: list[ColumnElement[bool]] = [GraphNode.kind.in_(KNOWLEDGE_KINDS)]
    if not include_pending:
        conds.append(GraphNode.status == "verified")
    if source:
        provenance = GraphNode.meta["provenance"]["source"].astext
        conds.append(provenance.is_(None) if source == "native" else provenance == source)

    refs = [
        NodeRef(row.id, row.kind, row.name)
        for row in db.execute(select(GraphNode.id, GraphNode.kind, GraphNode.name).where(*conds))
    ]

    # Kanten *zwischen* den ausgewählten Knoten — als Unterabfrage statt als Liste
    # von Tausenden Bind-Parametern, und ohne die ORM-Objekte zu materialisieren.
    selected_ids = select(GraphNode.id).where(*conds).scalar_subquery()
    edge_q = select(
        GraphEdge.source, GraphEdge.target, GraphEdge.relation, GraphEdge.weight, GraphEdge.status
    ).where(GraphEdge.source.in_(selected_ids), GraphEdge.target.in_(selected_ids))
    if not include_pending:
        edge_q = edge_q.where(GraphEdge.status == "verified")
    edges = list(db.execute(edge_q))

    # ``val`` zählt den vollen Vernetzungsgrad — vor dem Kappen. Sonst schrumpfte ein
    # Knoten allein deshalb, weil seine Nachbarn nicht mit ausgeliefert werden.
    val: dict[str, float] = defaultdict(float)
    for e in edges:
        val[str(e.source)] += e.weight
        val[str(e.target)] += e.weight

    if len(refs) > limit:
        refs = _cap_by_kind(refs, val, limit)
    kept_ids = {r.id for r in refs}
    edges = [e for e in edges if e.source in kept_ids and e.target in kept_ids]

    # Volle Zeilen (inkl. JSONB-``meta``) erst jetzt, für die tatsächliche Auswahl.
    by_id = {
        n.id: n for n in db.execute(select(GraphNode).where(GraphNode.id.in_(kept_ids))).scalars()
    }
    nodes = [by_id[r.id] for r in refs if r.id in by_id]

    # Öffentliche Sicht ist für alle gleich und ändert sich im Wochentakt; die
    # Review-Sicht enthält ungeprüfte Fakten und gehört in keinen Cache.
    if include_pending:
        no_store(response)
    else:
        public_cache(response)

    landmark_min = get_settings().citation_landmark_min

    def _citations(node: GraphNode) -> int | None:
        raw = (node.meta or {}).get("citations") or {}
        count = raw.get("citations")
        return int(count) if isinstance(count, int | float) else None

    return {
        "nodes": [
            {
                "id": str(n.id),
                "kind": n.kind,
                "name": n.name,
                "status": n.status,
                "first_seen": n.first_seen.isoformat(),
                "val": round(val.get(str(n.id), 0.0), 4) or 1.0,
                # Zitationszahl als eigenes Signal — die Knotengröße kodiert bereits
                # den Vernetzungsgrad und bleibt davon unberührt (ADR-0013).
                "citations": _citations(n),
                "landmark": (_citations(n) or 0) >= landmark_min,
                "meta": n.meta,
            }
            for n in nodes
        ],
        "links": [
            {
                "source": str(e.source),
                "target": str(e.target),
                "relation": e.relation,
                "weight": e.weight,
                "status": e.status,
            }
            for e in edges
        ],
    }


@router.get("/graph/changelog", dependencies=[Depends(rate_limit)])
def changelog(
    response: Response,
    days: int = Query(default=7, ge=1, le=365),
    limit: int = Query(default=200, ge=1, le=1000),
    db: Session = Depends(get_db),
) -> dict:
    """Verified knowledge-graph nodes first seen within the last `days` — "Neu"-Feed."""
    public_cache(response)
    since = datetime.now(UTC) - timedelta(days=days)
    rows = (
        db.execute(
            select(GraphNode)
            .where(
                GraphNode.kind.in_(KNOWLEDGE_KINDS),
                GraphNode.status == "verified",
                GraphNode.first_seen >= since,
            )
            .order_by(GraphNode.first_seen.desc())
            # 365 Tage mal ein PwC-Import sind Zehntausende Knoten — ungebremst
            # wäre der "Neu"-Feed die teuerste Antwort der API.
            .limit(limit)
        )
        .scalars()
        .all()
    )
    return {
        "days": days,
        "count": len(rows),
        "items": [
            {
                "id": str(n.id),
                "kind": n.kind,
                "name": n.name,
                "first_seen": n.first_seen.isoformat(),
            }
            for n in rows
        ],
    }
