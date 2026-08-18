"""Provenienz-Schema: document_sources, authors, document_authors, entities_extracted

Revision ID: 0005_provenance
Revises: 0004_pwc_graph_kinds
Create Date: 2026-08-18

Bisher lebte Provenienz in JSONB: ``meta.source_document_ids`` an den Kanten der
LLM-Extraktion, ``meta.provenance`` an den importierten Knoten (ADR-0017). Das
trägt, solange eine Aussage genau eine Quelle hat. Sobald zwei Quellen dieselbe
Aussage belegen, überschreibt der Upsert die eine mit der anderen — beim
PwC-Import betraf das 2 von 11 Knoten (bekannte Grenze in ADR-0017). Ein Löschen
„alles von Quelle X" träfe damit auch eigene Fakten.

Vier Tabellen, siehe ADR-0020:

* ``document_sources``   — woher ein Dokument stammt (mehrere je Dokument möglich)
* ``authors``            — Autor:innen als eigene Zeilen, **ohne** Kontaktfelder
* ``document_authors``   — Zuordnung samt Reihenfolge
* ``entities_extracted`` — welche Aussage stammt aus welcher Quelle, von welchem
  Extraktor, mit welcher Konfidenz — und ob sie im Konflikt steht

Der downgrade wirft die Tabellen weg; die JSONB-Felder bleiben unangetastet und
tragen den Bestand weiter.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0005_provenance"
down_revision: str | None = "0004_pwc_graph_kinds"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ---------------------------------------------------------------- Quellen
    # document_id ist NULL-bar: Der Harvester kennt einen Datensatz, lange bevor
    # ein PDF geholt und ein Dokument angelegt wurde (ADR-0018).
    op.execute(
        """
        CREATE TABLE document_sources (
            id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            document_id    UUID REFERENCES documents(id) ON DELETE CASCADE,
            source_system  TEXT NOT NULL,
            source_id      TEXT NOT NULL,
            source_url     TEXT,
            license        TEXT,
            doi            TEXT,
            title          TEXT,
            title_key      TEXT,
            fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            fetched_by     TEXT NOT NULL,
            meta           JSONB NOT NULL DEFAULT '{}',
            CONSTRAINT uq_document_sources_system_id UNIQUE (source_system, source_id)
        );
        """
    )
    # Dedupe-Pfade des Harvesters (DOI + Titelschlüssel) auch gegen den Bestand.
    op.execute("CREATE INDEX idx_document_sources_doi ON document_sources (doi);")
    op.execute("CREATE INDEX idx_document_sources_title_key ON document_sources (title_key);")
    op.execute("CREATE INDEX idx_document_sources_document ON document_sources (document_id);")

    # ---------------------------------------------------------------- Autor:innen
    # Identität ist **je Quellsystem** eindeutig, nicht global. Eine globale
    # Zusammenführung wäre genau die Cross-Source-Anreicherung auf Personenebene,
    # die dieses Projekt nicht betreibt (PLAN §7 Phase 11).
    #
    # Kontaktdaten sind nicht "nicht vorgesehen", sondern per CHECK verboten:
    # eine Regel, die nur in der Anwendung steht, hält keine zweite Schreibstelle auf.
    op.execute(
        """
        CREATE TABLE authors (
            id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            source_system  TEXT NOT NULL,
            name           TEXT NOT NULL,
            name_key       TEXT NOT NULL,
            first_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
            meta           JSONB NOT NULL DEFAULT '{}',
            CONSTRAINT uq_authors_system_key UNIQUE (source_system, name_key),
            CONSTRAINT ck_authors_no_email_in_name CHECK (position('@' in name) = 0),
            CONSTRAINT ck_authors_no_contact_meta CHECK (
                NOT (meta ?| ARRAY['email','emails','e_mail','mail','contact','phone'])
            )
        );
        """
    )
    op.execute(
        """
        CREATE TABLE document_authors (
            document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            author_id   UUID NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
            position    INT NOT NULL DEFAULT 0,
            PRIMARY KEY (document_id, author_id)
        );
        """
    )
    op.execute("CREATE INDEX idx_document_authors_author ON document_authors (author_id);")

    # ---------------------------------------------------------------- Extraktionen
    # Eine Zeile je Beleg: dieselbe Aussage aus zwei Quellen ergibt zwei Zeilen.
    # Genau das konnte das JSONB-Feld nicht.
    op.execute(
        """
        CREATE TABLE entities_extracted (
            id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            node_id        UUID REFERENCES graph_nodes(id) ON DELETE CASCADE,
            edge_source    UUID,
            edge_target    UUID,
            edge_relation  TEXT,
            document_id    UUID REFERENCES documents(id) ON DELETE CASCADE,
            source_id      UUID REFERENCES document_sources(id) ON DELETE SET NULL,
            extractor      TEXT NOT NULL,
            confidence     REAL,
            conflict       BOOLEAN NOT NULL DEFAULT FALSE,
            conflict_reason TEXT,
            extracted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            meta           JSONB NOT NULL DEFAULT '{}',
            CONSTRAINT fk_entities_extracted_edge
                FOREIGN KEY (edge_source, edge_target, edge_relation)
                REFERENCES graph_edges(source, target, relation) ON DELETE CASCADE,
            -- Ein Beleg ohne Aussage ist wertlos: entweder Knoten oder Kante.
            CONSTRAINT ck_entities_extracted_target CHECK (
                node_id IS NOT NULL
                OR (edge_source IS NOT NULL AND edge_target IS NOT NULL
                    AND edge_relation IS NOT NULL)
            ),
            -- NULLS NOT DISTINCT (PG15+): ohne das wäre jede Zeile mit NULL-Spalte
            -- für den Index einzigartig und der Upsert liefe ins Leere.
            CONSTRAINT uq_entities_extracted_claim UNIQUE NULLS NOT DISTINCT
                (node_id, edge_source, edge_target, edge_relation, document_id,
                 source_id, extractor)
        );
        """
    )
    op.execute("CREATE INDEX idx_entities_extracted_node ON entities_extracted (node_id);")
    op.execute(
        "CREATE INDEX idx_entities_extracted_edge "
        "ON entities_extracted (edge_source, edge_target, edge_relation);"
    )
    op.execute(
        "CREATE INDEX idx_entities_extracted_conflict "
        "ON entities_extracted (conflict) WHERE conflict;"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS entities_extracted;")
    op.execute("DROP TABLE IF EXISTS document_authors;")
    op.execute("DROP TABLE IF EXISTS authors;")
    op.execute("DROP TABLE IF EXISTS document_sources;")
