"""Provenienz schreiben und abfragen (Migration 0005, ADR-0020).

Alle Schreibwege sind idempotent — Ernte, Import und Extraktion laufen wiederholt,
und ein zweiter Lauf darf keinen zweiten Beleg für dieselbe Aussage erzeugen.
Konflikte werden **markiert**, nie durch Überschreiben aufgelöst (PLAN §2.7).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.db.models import Author, DocumentAuthor, DocumentSource, EntityExtraction

_WS = re.compile(r"\s+")
_NON_WORD = re.compile(r"[^\w\s]", re.UNICODE)

#: Felder, die an einer Autor:in nie gespeichert werden. Die Datenbank lehnt sie
#: per CHECK ab; hier fallen sie schon vorher weg, damit der Aufrufer keinen
#: Constraint-Fehler statt einer klaren Regel sieht.
FORBIDDEN_AUTHOR_META = frozenset(
    {"email", "emails", "e_mail", "mail", "contact", "phone", "authorids"}
)


def name_key(name: str) -> str:
    """Vergleichsschlüssel eines Personennamens — klein, ohne Satzzeichen."""
    return _WS.sub(" ", _NON_WORD.sub(" ", (name or "").lower())).strip()


@dataclass
class Claim:
    """Eine belegte Aussage: entweder ein Knoten oder eine Kante."""

    node_id: str | None = None
    edge: tuple[str, str, str] | None = None

    def as_columns(self) -> dict[str, Any]:
        source, target, relation = self.edge or (None, None, None)
        return {
            "node_id": self.node_id,
            "edge_source": source,
            "edge_target": target,
            "edge_relation": relation,
        }


# ------------------------------------------------------------------ Quellen


def record_source(
    session: Session,
    *,
    source_system: str,
    source_id: str,
    fetched_by: str,
    document_id: str | None = None,
    source_url: str | None = None,
    license: str | None = None,
    doi: str | None = None,
    title: str | None = None,
    title_key: str | None = None,
    fetched_at: Any = None,
    meta: dict[str, Any] | None = None,
) -> str:
    """Herkunft eines Datensatzes festhalten. Gibt die Id des Quellen-Eintrags.

    Beim zweiten Fund werden nur Felder aktualisiert, die neu belastbar sind —
    ``fetched_at``/``fetched_by`` rücken mit, eine einmal gesetzte
    ``document_id`` wird nicht durch NULL ersetzt.
    """
    values: dict[str, Any] = {
        "source_system": source_system,
        "source_id": source_id,
        "fetched_by": fetched_by,
        "document_id": document_id,
        "source_url": source_url,
        "license": license,
        "doi": doi,
        "title": title,
        "title_key": title_key,
        "meta": meta or {},
    }
    if fetched_at is not None:
        values["fetched_at"] = fetched_at

    ins = pg_insert(DocumentSource).values(**values)
    update = {
        "fetched_at": ins.excluded.fetched_at,
        "fetched_by": ins.excluded.fetched_by,
        "meta": DocumentSource.meta.op("||")(ins.excluded.meta),
        # coalesce: ein späterer Lauf ohne Dokumentbezug darf den bestehenden
        # nicht löschen.
        "document_id": func.coalesce(ins.excluded.document_id, DocumentSource.document_id),
        "source_url": func.coalesce(ins.excluded.source_url, DocumentSource.source_url),
        "license": func.coalesce(ins.excluded.license, DocumentSource.license),
        "doi": func.coalesce(ins.excluded.doi, DocumentSource.doi),
        "title": func.coalesce(ins.excluded.title, DocumentSource.title),
        "title_key": func.coalesce(ins.excluded.title_key, DocumentSource.title_key),
    }
    stmt = ins.on_conflict_do_update(
        constraint="uq_document_sources_system_id", set_=update
    ).returning(DocumentSource.id)
    return str(session.execute(stmt).scalar_one())


def find_duplicate_source(
    session: Session, *, doi: str | None, title_key: str | None
) -> DocumentSource | None:
    """Bekannter Datensatz über DOI **oder** Titelschlüssel (ADR-0018).

    Quellenübergreifend: Dieselbe Arbeit auf arXiv und OpenReview soll beim
    zweiten Fund auffallen.
    """
    clauses = []
    if doi:
        clauses.append(DocumentSource.doi == doi)
    if title_key:
        clauses.append(DocumentSource.title_key == title_key)
    if not clauses:
        return None
    return session.execute(select(DocumentSource).where(or_(*clauses))).scalars().first()


# ------------------------------------------------------------------ Autor:innen


def record_authors(
    session: Session,
    names: list[str],
    *,
    source_system: str,
    document_id: str | None = None,
    meta: dict[str, Any] | None = None,
) -> list[str]:
    """Autor:innen anlegen/wiederfinden und optional an ein Dokument hängen.

    Namen mit ``@`` werden verworfen statt bereinigt: Ein Name, in dem eine
    Adresse steckt, ist ein Parsefehler — den still zu reparieren verdeckt ihn.
    """
    clean_meta = {k: v for k, v in (meta or {}).items() if k not in FORBIDDEN_AUTHOR_META}
    ids: list[str] = []
    for position, raw in enumerate(names):
        name = _WS.sub(" ", (raw or "").strip())
        key = name_key(name)
        if not key or "@" in name:
            continue
        ins = pg_insert(Author).values(
            source_system=source_system, name=name, name_key=key, meta=clean_meta
        )
        stmt = ins.on_conflict_do_update(
            constraint="uq_authors_system_key",
            set_={"meta": Author.meta.op("||")(ins.excluded.meta)},
        ).returning(Author.id)
        author_id = str(session.execute(stmt).scalar_one())
        ids.append(author_id)
        if document_id is not None:
            link = pg_insert(DocumentAuthor).values(
                document_id=document_id, author_id=author_id, position=position
            )
            session.execute(link.on_conflict_do_nothing())
    return ids


# ------------------------------------------------------------------ Extraktionen


def record_extraction(
    session: Session,
    claim: Claim,
    *,
    extractor: str,
    document_id: str | None = None,
    source_id: str | None = None,
    confidence: float | None = None,
    conflict: bool = False,
    conflict_reason: str | None = None,
    meta: dict[str, Any] | None = None,
) -> str:
    """Einen Beleg festhalten. Zweiter identischer Beleg erzeugt keine zweite Zeile."""
    values = {
        **claim.as_columns(),
        "document_id": document_id,
        "source_id": source_id,
        "extractor": extractor,
        "confidence": confidence,
        "conflict": conflict,
        "conflict_reason": conflict_reason,
        "meta": meta or {},
    }
    ins = pg_insert(EntityExtraction).values(**values)
    stmt = ins.on_conflict_do_update(
        constraint="uq_entities_extracted_claim",
        set_={
            "confidence": func.coalesce(ins.excluded.confidence, EntityExtraction.confidence),
            "meta": EntityExtraction.meta.op("||")(ins.excluded.meta),
            # Ein einmal gesetzter Konflikt verschwindet nicht durch einen
            # weiteren Lauf — aufgelöst wird er im Review, nicht im Import.
            "conflict": EntityExtraction.conflict.op("OR")(ins.excluded.conflict),
            "conflict_reason": func.coalesce(
                EntityExtraction.conflict_reason, ins.excluded.conflict_reason
            ),
        },
    ).returning(EntityExtraction.id)
    return str(session.execute(stmt).scalar_one())


def mark_conflict(session: Session, claim: Claim, reason: str) -> int:
    """Alle Belege einer Aussage als strittig markieren. Gibt die Trefferzahl."""
    columns = claim.as_columns()
    conditions = [
        getattr(EntityExtraction, name) == value
        for name, value in columns.items()
        if value is not None
    ]
    if not conditions:
        return 0
    rows = session.execute(select(EntityExtraction).where(and_(*conditions))).scalars().all()
    for row in rows:
        row.conflict = True
        if not row.conflict_reason:
            row.conflict_reason = reason
    return len(rows)


def sources_for(session: Session, claim: Claim) -> list[str]:
    """Quellsysteme, die eine Aussage belegen — sortiert, ohne Wiederholung.

    Das ist die Frage, die ``meta.provenance`` nicht beantworten konnte: Wird ein
    Knoten von der eigenen Extraktion **und** von einer Fremdquelle getragen?
    """
    columns = claim.as_columns()
    conditions = [
        getattr(EntityExtraction, name) == value
        for name, value in columns.items()
        if value is not None
    ]
    if not conditions:
        return []
    rows = (
        session.execute(
            select(DocumentSource.source_system)
            .select_from(EntityExtraction)
            .join(DocumentSource, EntityExtraction.source_id == DocumentSource.id)
            .where(and_(*conditions))
            .distinct()
        )
        .scalars()
        .all()
    )
    return sorted(row for row in rows if row)


def independent_source_counts_by_node(session: Session) -> dict[str, int]:
    """Belegzahl **je Knoten** in einer Abfrage.

    ``independent_source_count`` einzeln je Knoten aufzurufen wäre ein N+1: die
    Promotion läuft über den gesamten Graphen. Gezählt wird wie dort — nach
    unterschiedlichem Herkunftsdokument, ersatzweise nach Quellsystem.
    """
    rows = session.execute(
        select(
            EntityExtraction.node_id,
            func.count(
                func.distinct(
                    func.coalesce(EntityExtraction.document_id, EntityExtraction.source_id)
                )
            ),
        )
        .where(EntityExtraction.node_id.is_not(None))
        .group_by(EntityExtraction.node_id)
    )
    return {str(node_id): int(count) for node_id, count in rows}


def independent_source_count(session: Session, claim: Claim) -> int:
    """Wie viele **unterschiedliche** Quellen eine Aussage belegen.

    Die Promotionsregel aus Phase 8 („≥ 2 unabhängige Quellen", ADR-0010) zählte
    bisher Dokument-Ids in einem JSONB-Feld. Hier zählt sie belegte Zeilen.
    """
    columns = claim.as_columns()
    conditions = [
        getattr(EntityExtraction, name) == value
        for name, value in columns.items()
        if value is not None
    ]
    if not conditions:
        return 0
    return int(
        session.execute(
            select(
                func.count(
                    func.distinct(
                        func.coalesce(EntityExtraction.document_id, EntityExtraction.source_id)
                    )
                )
            ).where(and_(*conditions))
        ).scalar_one()
    )


__all__ = [
    "Claim",
    "FORBIDDEN_AUTHOR_META",
    "find_duplicate_source",
    "independent_source_count",
    "independent_source_counts_by_node",
    "mark_conflict",
    "name_key",
    "record_authors",
    "record_extraction",
    "record_source",
    "sources_for",
]
