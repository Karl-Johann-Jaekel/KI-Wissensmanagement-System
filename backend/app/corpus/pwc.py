"""Papers-with-Code-Dump → Wissens-Graph (ADR-0017).

Papers with Code wurde Mitte 2025 abgeschaltet; das Archiv liegt als CC-BY-SA-Dump
vor und ist damit der beste Kaltstart-Datensatz für diesen Graphen: Papers,
Code-Repos, Datensätze, Tasks und SOTA-Zeilen sind bereits strukturiert — kein LLM
muss sie erst aus Fließtext raten.

Deshalb entstehen die Fakten hier **regelbasiert und direkt ``verified``**, wie schon
der Manifest-Import aus Phase 1 (PLAN §7). Das ist kein Widerspruch zu PLAN §2.7:
``pending`` schützt vor LLM-Halluzination, nicht vor kuratierten Fremddaten. Jeder
Knoten und jede Kante trägt ``meta.provenance`` (Quelle, URL, Zeitpunkt, Lizenz) —
Pflicht, damit eine spätere Löschanfrage die betroffenen Zeilen findet.

    python scripts/fetch_pwc_dump.py --out data/pwc
    python -m app.corpus.pwc --dump data/pwc --limit 5000
    python -m app.corpus.pwc --dump data/pwc --limit 500 --match "retrieval|agent"

Dump-Bestandteile: ``papers-with-abstracts``, ``links-between-papers-and-code``,
``evaluation-tables``, ``datasets`` — als Parquet-Shards (Hugging-Face-Archiv,
Stand nach der Abschaltung) oder als historische ``.json``/``.json.gz``.
"""

from __future__ import annotations

import argparse
import gzip
import json
import re
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.corpus.aliases import canonical_key, is_plausible_entity, normalize_entity
from app.db.graph import upsert_edge, upsert_node
from app.db.models import GraphNode

PWC_SOURCE = "paperswithcode"
PWC_LICENSE = "CC-BY-SA-4.0"
PWC_ARCHIVE = "https://github.com/paperswithcode/paperswithcode-data"

DUMP_STEMS = {
    "papers": "papers-with-abstracts",
    "links": "links-between-papers-and-code",
    "evaluation": "evaluation-tables",
    "datasets": "datasets",
}

#: Arten, deren Namen über ``canonical_key`` mit dem bestehenden Graphen verschmelzen.
NORMALIZED_KINDS = ("concept", "model", "dataset", "task")

#: Titel unterhalb dieser Länge sind Rauschen ("Untitled", "-").
MIN_TITLE_LEN = 8
_WS = re.compile(r"\s+")


# ------------------------------------------------------------------ Datenmodell

NodeKey = tuple[str, str]  # (kind, Name aus dem Dump)


@dataclass
class PwcGraph:
    """Normalisiertes Zwischenergebnis — bewusst ohne DB, damit es testbar bleibt."""

    nodes: dict[NodeKey, dict[str, Any]] = field(default_factory=dict)
    edges: dict[tuple[NodeKey, NodeKey, str], dict[str, Any]] = field(default_factory=dict)
    papers: list[dict[str, Any]] = field(default_factory=list)

    def add_node(self, kind: str, name: str, meta: dict[str, Any]) -> NodeKey | None:
        if not name:
            return None
        key = (kind, name)
        existing = self.nodes.get(key)
        if existing is None:
            self.nodes[key] = dict(meta)
        else:
            # Erste Nennung gewinnt; nur fehlende Felder werden ergänzt.
            for field_name, value in meta.items():
                existing.setdefault(field_name, value)
        return key

    def add_edge(
        self,
        source: NodeKey | None,
        target: NodeKey | None,
        relation: str,
        *,
        weight: float = 1.0,
        meta: dict[str, Any] | None = None,
    ) -> None:
        if source is None or target is None or source == target:
            return
        key = (source, target, relation)
        existing = self.edges.get(key)
        if existing is None:
            self.edges[key] = {"weight": weight, "meta": dict(meta or {})}
        else:
            existing["weight"] = max(existing["weight"], weight)

    def counts(self) -> dict[str, int]:
        by_kind: dict[str, int] = {}
        for kind, _name in self.nodes:
            by_kind[kind] = by_kind.get(kind, 0) + 1
        by_kind["edges"] = len(self.edges)
        return by_kind


@dataclass
class PwcStats:
    papers: int = 0
    nodes: int = 0
    edges: int = 0
    documents: int = 0
    chunks: int = 0


# ------------------------------------------------------------------ Dump lesen


def dump_files(dump_dir: Path, name: str) -> list[Path]:
    """Alle Dateien eines Dump-Bestandteils, in stabiler Reihenfolge.

    Das Archiv liegt seit der Abschaltung als **Parquet-Shards** auf Hugging Face
    (``<stem>.00.parquet``, …); die historischen ``.json``/``.json.gz`` werden
    weiter gelesen, damit ältere Kopien und die Tests ohne Parquet auskommen.
    """
    stem = DUMP_STEMS[name]
    for suffix in (".json", ".json.gz"):
        single = dump_dir / f"{stem}{suffix}"
        if single.exists():
            return [single]
    shards = sorted(dump_dir.glob(f"{stem}.parquet")) or sorted(
        dump_dir.glob(f"{stem}.[0-9][0-9].parquet")
    )
    return shards


def _prune_nulls(value: Any) -> Any:
    """Leere Felder aus verschachtelten Strukturen entfernen, Zeitstempel zu Datum."""
    if isinstance(value, dict):
        return {k: _prune_nulls(v) for k, v in value.items() if v is not None}
    if isinstance(value, list):
        return [_prune_nulls(v) for v in value]
    if isinstance(value, datetime | date):
        # Der Dump führt `date` als Zeitstempel; im Graphen steht ein Datum.
        return value.isoformat()[:10]
    return value


#: Struct-Felder, die beim Parquet-Lesen wegfallen (Name -> nur wenn Struct).
DROPPED_STRUCT_FIELDS = ("metrics",)


def iter_dump(dump_dir: Path, name: str) -> Iterator[dict] | None:
    """Zeilen eines Dump-Bestandteils streamen; ``None`` wenn er fehlt.

    Streamen statt Laden, weil allein ``papers-with-abstracts`` rund eine halbe
    Million Zeilen trägt — die Teilmengen-Auswahl bricht früh ab und soll dafür
    nicht erst den ganzen Dump im Speicher aufbauen.
    """
    files = dump_files(dump_dir, name)
    if not files:
        return None
    return _iter_files(files)


def _iter_files(files: list[Path]) -> Iterator[dict]:
    for path in files:
        if path.suffix == ".parquet":
            yield from _iter_parquet(path)
        elif path.suffixes[-2:] == [".json", ".gz"]:
            with gzip.open(path, "rt", encoding="utf-8") as fh:
                yield from json.load(fh)
        else:
            yield from json.loads(path.read_text(encoding="utf-8"))


def _lean_type(dtype: Any) -> Any:
    """Arrow-Typ ohne die Felder aus :data:`DROPPED_STRUCT_FIELDS` (rekursiv)."""
    import pyarrow as pa

    if pa.types.is_list(dtype) or pa.types.is_large_list(dtype):
        return pa.list_(_lean_type(dtype.value_type))
    if pa.types.is_struct(dtype):
        keep = [
            pa.field(f.name, _lean_type(f.type))
            for f in dtype
            if not (f.name in DROPPED_STRUCT_FIELDS and pa.types.is_struct(f.type))
        ]
        return pa.struct(keep)
    return dtype


def _iter_parquet(path: Path, batch_size: int = 256) -> Iterator[dict]:
    """Parquet-Shard zeilenweise als Dicts.

    Vor der Umwandlung nach Python wird der Typ **in Arrow** verschlankt: Die
    Konvertierung des Archivs hat die SOTA-Metriken zu einem Struct mit einer
    Spalte je Metrikname im gesamten Datensatz ausgerollt — 3.468 Felder, davon
    typisch eines belegt. ``to_pylist`` würde daraus je SOTA-Zeile ein Dict mit
    3.468 Schlüsseln bauen und den Prozess aus dem Speicher tragen (gemessen:
    OOM-Kill). Der Cast wirft das Feld weg, bevor ein Python-Objekt entsteht.
    """
    import pyarrow as pa
    import pyarrow.parquet as pq

    handle = pq.ParquetFile(path)
    lean = pa.schema([pa.field(f.name, _lean_type(f.type)) for f in handle.schema_arrow])
    for batch in handle.iter_batches(batch_size=batch_size):
        for row in pa.Table.from_batches([batch]).cast(lean).to_pylist():
            yield _prune_nulls(row)


def load_dump(dump_dir: Path, name: str) -> list[dict] | None:
    """Einen Dump-Bestandteil vollständig laden; ``None`` wenn er fehlt.

    Nur ``papers`` ist Pflicht — mit einer Teilmenge der Dateien entsteht ein
    kleinerer, aber konsistenter Graph.
    """
    rows = iter_dump(dump_dir, name)
    return None if rows is None else list(rows)


def _clean(value: Any) -> str:
    return _WS.sub(" ", str(value or "")).strip()


def paper_title(entry: dict) -> str:
    return _clean(entry.get("title"))


def select_papers(papers: Iterable[dict], *, limit: int, match: str | None = None) -> list[dict]:
    """Deterministische Teilmenge: Dateireihenfolge, optional per Regex gefiltert.

    Der Regex trifft Titel, Abstract und Tasks — so lässt sich der Dump auf die
    Themen des Korpus (RAG, Agenten, Retrieval) eindampfen, statt 400.000 Papers
    quer durch alle Disziplinen zu importieren.
    """
    pattern = re.compile(match, re.IGNORECASE) if match else None
    out: list[dict] = []
    seen: set[str] = set()
    for entry in papers:
        title = paper_title(entry)
        if len(title) < MIN_TITLE_LEN:
            continue
        key = canonical_key(title)
        if key in seen:
            continue
        if pattern is not None:
            haystack = " ".join(
                [title, _clean(entry.get("abstract")), " ".join(entry.get("tasks") or [])]
            )
            if not pattern.search(haystack):
                continue
        seen.add(key)
        out.append(entry)
        if len(out) >= limit:
            break
    return out


# ------------------------------------------------------------------ Normalisierung


def repo_name(url: str) -> str:
    """``https://github.com/foo/bar`` → ``foo/bar`` — kurzer Knotenname, volle URL in meta."""
    cleaned = _clean(url).rstrip("/")
    if not cleaned:
        return ""
    without_scheme = re.sub(r"^https?://", "", cleaned)
    parts = without_scheme.split("/")
    return "/".join(parts[1:3]) if len(parts) >= 3 else without_scheme


def _entity_name(raw: str) -> str:
    name = normalize_entity(_clean(raw))
    return name if name and is_plausible_entity(name) else ""


def _provenance(source_url: str, fetched_at: str) -> dict[str, Any]:
    """Provenienz-Block — Pflichtfeld für jede importierte Zeile (DSGVO-Löschpfad)."""
    return {
        "provenance": {
            "source": PWC_SOURCE,
            "source_url": source_url or PWC_ARCHIVE,
            "fetched_at": fetched_at,
            "license": PWC_LICENSE,
        }
    }


def _iter_eval_tasks(tables: Iterable[dict]) -> Iterator[dict]:
    """Evaluation-Tables sind rekursiv (``subtasks``) — flach durchlaufen.

    Die oberste Ebene wird gestreamt (eine Tabelle nach der anderen), nur deren
    Unterbaum liegt kurzzeitig im Speicher. Der gesamte Bestand auf einmal wäre
    ein Vielfaches des Arbeitsspeichers.
    """
    for table in tables:
        stack = [table]
        while stack:
            node = stack.pop()
            if not isinstance(node, dict):
                continue
            stack.extend(node.get("subtasks") or [])
            yield node


def build_graph(
    papers: list[dict],
    *,
    links: Iterable[dict] | None = None,
    evaluation: Iterable[dict] | None = None,
    datasets: Iterable[dict] | None = None,
    fetched_at: str | None = None,
) -> PwcGraph:
    """Dump-Einträge → Knoten/Kanten. Reine Funktion, keine DB, kein Netz.

    ``links``, ``evaluation`` und ``datasets`` werden **einmal** durchlaufen und
    dürfen deshalb Generatoren sein — der Dump passt sonst nicht in den Speicher.
    Nur die ausgewählten ``papers`` liegen als Liste vor.
    """
    stamp = fetched_at or datetime.now(UTC).isoformat(timespec="seconds")
    graph = PwcGraph(papers=list(papers))

    paper_key_by_title: dict[str, NodeKey] = {}
    for entry in papers:
        title = paper_title(entry)
        url = _clean(entry.get("url_abs")) or _clean(entry.get("paper_url"))
        prov = _provenance(url, stamp)
        key = graph.add_node(
            "paper",
            title,
            {
                "arxiv_id": _clean(entry.get("arxiv_id")) or None,
                "date": _clean(entry.get("date")) or None,
                "proceeding": _clean(entry.get("proceeding")) or None,
                "url": url or None,
                # Autorennamen ohne Kontaktdaten; keine Personen-Knoten (PLAN §6).
                "authors": [_clean(a) for a in (entry.get("authors") or [])][:20],
                **prov,
            },
        )
        if key is None:
            continue
        paper_key_by_title[canonical_key(title)] = key

        for raw_task in entry.get("tasks") or []:
            task_key = graph.add_node("task", _entity_name(raw_task), prov)
            graph.add_edge(key, task_key, "RELATED_TO", meta=prov)

        for method in entry.get("methods") or []:
            raw = method.get("name") if isinstance(method, dict) else method
            concept_key = graph.add_node("concept", _entity_name(raw or ""), prov)
            graph.add_edge(key, concept_key, "USES", meta=prov)

    for link in links or []:
        paper_key = paper_key_by_title.get(canonical_key(_clean(link.get("paper_title"))))
        if paper_key is None:
            continue  # Repos ohne Paper aus der Teilmenge bleiben draußen.
        url = _clean(link.get("repo_url"))
        official = bool(link.get("is_official"))
        prov = _provenance(url, stamp)
        repo_key = graph.add_node(
            "repo",
            repo_name(url),
            {
                "url": url or None,
                "framework": _clean(link.get("framework")) or None,
                "is_official": official,
                **prov,
            },
        )
        # Offizielle Implementierungen wiegen doppelt — sie belegen die Kante stärker.
        graph.add_edge(
            repo_key,
            paper_key,
            "IMPLEMENTS",
            weight=1.0 if official else 0.5,
            meta={"is_official": official, **prov},
        )

    prov_eval = _provenance("", stamp)
    for task_table in _iter_eval_tasks(evaluation or []):
        task_name = _entity_name(task_table.get("task") or "")
        for dataset_entry in task_table.get("datasets") or []:
            if not isinstance(dataset_entry, dict):
                continue
            sota = dataset_entry.get("sota") or {}
            rows = [r for r in (sota.get("rows") or []) if isinstance(r, dict)]
            # Die Metriknamen des Datensatzes (`sota.metrics`) überleben den
            # Parquet-Import, die Messwerte je Zeile nicht — s. `_iter_parquet`.
            metric_names = [_clean(m) for m in (sota.get("metrics") or []) if _clean(m)]
            # Nur Zeilen, deren Paper in der Teilmenge liegt — sonst hängt der halbe
            # Dump als Insel im Graphen.
            relevant = [
                (row, paper_key_by_title.get(canonical_key(_clean(row.get("paper_title")))))
                for row in rows
            ]
            relevant = [(row, key) for row, key in relevant if key is not None]
            if not relevant:
                continue
            dataset_key = graph.add_node(
                "dataset", _entity_name(dataset_entry.get("dataset") or ""), prov_eval
            )
            task_key = graph.add_node("task", task_name, prov_eval)
            graph.add_edge(dataset_key, task_key, "RELATED_TO", meta=prov_eval)
            for row, paper_key in relevant:
                model_key = graph.add_node(
                    "model", _entity_name(row.get("model_name") or ""), prov_eval
                )
                graph.add_edge(paper_key, dataset_key, "USES_DATASET", meta=prov_eval)
                graph.add_edge(paper_key, model_key, "INTRODUCES", meta=prov_eval)
                graph.add_edge(
                    model_key,
                    dataset_key,
                    "ACHIEVES_SOTA",
                    meta={
                        "task": task_name or None,
                        # Werte, falls die Quelle sie liefert (JSON-Kopie); sonst
                        # wenigstens, worauf gemessen wurde.
                        "metrics": row.get("metrics") or {},
                        "metric_names": metric_names,
                        **prov_eval,
                    },
                )

    # Nur bereits verlinkte Datasets anreichern — der Dump kennt Tausende weiterer.
    for entry in datasets or []:
        meta = graph.nodes.get(("dataset", _entity_name(entry.get("name") or "")))
        if meta is None:
            continue
        meta.setdefault("full_name", _clean(entry.get("full_name")) or None)
        meta.setdefault("url", _clean(entry.get("url")) or None)

    return graph


# ------------------------------------------------------------------ Schreiben


def load_vocabulary(session: Session) -> dict[tuple[str, str], str]:
    """``(kind, canonical_key) → Anzeigename`` des Bestands.

    Damit landet „retrieval-augmented generation" aus dem Dump auf demselben Knoten
    wie „Retrieval-Augmented Generation" aus der LLM-Extraktion (ADR-0012).
    """
    rows = session.execute(
        select(GraphNode.kind, GraphNode.name, GraphNode.status).where(
            GraphNode.kind.in_(NORMALIZED_KINDS), GraphNode.status != "rejected"
        )
    ).all()
    rows = sorted(rows, key=lambda r: r.status != "verified")
    vocab: dict[tuple[str, str], str] = {}
    for kind, name, _status in rows:
        key = canonical_key(name)
        if key:
            vocab.setdefault((kind, key), name)
    return vocab


def write_graph(session: Session, graph: PwcGraph, *, status: str = "verified") -> PwcStats:
    """Knoten/Kanten idempotent schreiben (``app.db.graph``-Upserts, kein Overwrite)."""
    vocab = load_vocabulary(session)
    ids: dict[NodeKey, str] = {}
    stats = PwcStats(papers=len(graph.papers))

    for (kind, name), meta in graph.nodes.items():
        display = name
        if kind in NORMALIZED_KINDS:
            key = canonical_key(name)
            display = vocab.get((kind, key), name)
            if key:
                vocab.setdefault((kind, key), display)
        ids[(kind, name)] = upsert_node(session, kind, display, meta, status=status)
        stats.nodes += 1

    for (source, target, relation), payload in graph.edges.items():
        src, dst = ids.get(source), ids.get(target)
        if src is None or dst is None or src == dst:
            continue
        upsert_edge(
            session,
            src,
            dst,
            relation,
            weight=payload["weight"],
            meta=payload["meta"],
            status=status,
        )
        stats.edges += 1

    session.commit()
    return stats


def paper_markdown(entry: dict) -> str:
    """Titel + Abstract als Markdown — die Textbasis für Chunks/Embeddings."""
    title = paper_title(entry)
    abstract = _clean(entry.get("abstract"))
    return f"# {title}\n\n{abstract}\n" if abstract else ""


def ingest_abstracts(
    session: Session,
    papers: list[dict],
    *,
    embed_fn: Callable[[list[str]], list[list[float]]] | None = None,
) -> tuple[int, int]:
    """Abstracts als Dokumente + Chunks in pgvector (nur CC-BY-SA-Text, PLAN §2.5).

    Bewusst optional: 5.000 Abstracts kosten 5.000 Embedding-Aufrufe. Ohne das Flag
    entsteht nur der Graph.
    """
    from app.ingestion.embedding import embed_texts
    from app.ingestion.pipeline import ingest_text

    embed = embed_fn or embed_texts
    stamp = datetime.now(UTC).isoformat(timespec="seconds")
    added = chunks = 0
    for entry in papers:
        md = paper_markdown(entry)
        if not md:
            continue
        url = _clean(entry.get("url_abs")) or _clean(entry.get("paper_url"))
        status, n = ingest_text(
            session,
            title=paper_title(entry),
            text=md,
            uri=url or None,
            source_type="pwc_abstract",
            meta={
                "arxiv_id": _clean(entry.get("arxiv_id")) or None,
                "authors": [_clean(a) for a in (entry.get("authors") or [])][:20],
                "published": _clean(entry.get("date")) or None,
                **_provenance(url, stamp),
            },
            embed_fn=embed,
        )
        if status == "added":
            added += 1
            chunks += n
    return added, chunks


# ------------------------------------------------------------------ CLI


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Import des Papers-with-Code-Dumps.")
    parser.add_argument("--dump", default="data/pwc", help="Verzeichnis mit den Dump-Dateien")
    parser.add_argument("--limit", type=int, default=5000, help="max. Papers (Teilmenge)")
    parser.add_argument("--match", default=None, help="Regex auf Titel/Abstract/Tasks")
    parser.add_argument(
        "--status",
        default="verified",
        choices=("verified", "pending"),
        help="Status der Fakten (Default verified — deterministischer Import)",
    )
    parser.add_argument("--ingest-abstracts", action="store_true", help="Abstracts nach pgvector")
    parser.add_argument("--dry-run", action="store_true", help="nur zählen, nichts schreiben")
    args = parser.parse_args(argv)

    dump_dir = Path(args.dump)
    rows = iter_dump(dump_dir, "papers")
    if rows is None:
        parser.error(
            f"{DUMP_STEMS['papers']}.parquet/.json[.gz] fehlt in {dump_dir} — "
            f"Dump laden: scripts/fetch_pwc_dump.py ({PWC_ARCHIVE})"
        )
        return 2

    # Gestreamt: die Auswahl bricht bei --limit ab, ohne den ganzen Dump zu laden.
    papers = select_papers(rows, limit=args.limit, match=args.match)
    print(f"Papers ausgewählt: {len(papers)}")
    # Alles außer der Paper-Teilmenge wird gestreamt — der Dump ist deutlich
    # größer als der Arbeitsspeicher des Containers.
    graph = build_graph(
        papers,
        links=iter_dump(dump_dir, "links"),
        evaluation=iter_dump(dump_dir, "evaluation"),
        datasets=iter_dump(dump_dir, "datasets"),
    )
    print(f"Graph: {graph.counts()}")

    if args.dry_run:
        print("dry-run — nichts geschrieben.")
        return 0

    from app.db.session import SessionLocal

    with SessionLocal() as session:
        stats = write_graph(session, graph, status=args.status)
        if args.ingest_abstracts:
            stats.documents, stats.chunks = ingest_abstracts(session, papers)
    print(
        f"Done. nodes={stats.nodes} edges={stats.edges} "
        f"documents={stats.documents} chunks={stats.chunks}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
