"""GET /stats — Kennzahlen des Bestands in einer billigen Antwort.

Die Einstiegsseite nannte ihre Zahlen bisher wörtlich im Quelltext (»56 Papers«,
»6.950 Textabschnitte«, »13.271 Knoten«). Der Update-Loop schiebt den Bestand
weiter, die Sätze blieben stehen — gemessen waren es 69 Dokumente und 8.300
Abschnitte. Eine Anwendung, deren Versprechen »jede Aussage mit Beleg« ist, darf
ihre eigene Bestandsangabe nicht raten.

Zählen statt ausliefern: ``/graph`` kappt seine Antwort auf
``DEFAULT_NODE_LIMIT`` und kann die wahre Größe deshalb gar nicht nennen. Hier
stehen vier ``COUNT``-Abfragen, keine Zeile wandert nach Python.

Gezählt wird genau das, was die öffentliche Sicht auch zeigt: bestätigte Knoten
der Wissensarten. Sonst stünde auf der Startseite eine Zahl, die im Graphen
niemand wiederfindet.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.graph import DEFAULT_NODE_LIMIT, KNOWLEDGE_KINDS
from app.core.http import public_cache
from app.core.security import rate_limit
from app.db.models import Chunk, Document, GraphEdge, GraphNode
from app.db.session import get_db

router = APIRouter(tags=["stats"])


@router.get("/stats", dependencies=[Depends(rate_limit)])
def get_stats(response: Response, db: Session = Depends(get_db)) -> dict[str, int]:
    """Bestandsgrößen: Dokumente, Textabschnitte, Graph-Knoten und -Kanten.

    ``node_limit`` sagt dazu, wie viele Knoten eine einzelne ``/graph``-Antwort
    höchstens enthält — damit die Oberfläche »2.000 von 13.271« schreiben kann
    statt so zu tun, als sei der Ausschnitt der Bestand.
    """
    public_cache(response)

    verified = (GraphNode.kind.in_(KNOWLEDGE_KINDS), GraphNode.status == "verified")
    node_ids = select(GraphNode.id).where(*verified).scalar_subquery()
    nodes = select(func.count()).select_from(GraphNode).where(*verified)

    return {
        "documents": db.execute(select(func.count()).select_from(Document)).scalar_one(),
        "chunks": db.execute(select(func.count()).select_from(Chunk)).scalar_one(),
        "nodes": db.execute(nodes).scalar_one(),
        # Kanten *zwischen* sichtbaren Knoten — eine Kante an einen ungeprüften
        # Knoten taucht in der öffentlichen Sicht nirgends auf.
        "edges": db.execute(
            select(func.count())
            .select_from(GraphEdge)
            .where(
                GraphEdge.status == "verified",
                GraphEdge.source.in_(node_ids),
                GraphEdge.target.in_(node_ids),
            )
        ).scalar_one(),
        "node_limit": DEFAULT_NODE_LIMIT,
    }
