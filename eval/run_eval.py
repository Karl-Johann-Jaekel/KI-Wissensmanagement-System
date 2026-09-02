"""Golden-set retrieval eval (PLAN §7 Phase 4 DoD: Hit-Rate@5 >= 0.8, latency < 2s).

    python eval/run_eval.py [--golden eval/golden.yaml] [--top-k 5] [--with-rerank]
    python eval/run_eval.py --with-citations     # zusaetzlich Belegtreue messen

Reports Hit-Rate@k and latency percentiles, with and (optionally) without the
reranker. A hit = the expected paper's arXiv id appears among the top-k results.

``--with-citations`` misst zusaetzlich, ob die *erzeugten Antworten* ihre Quellen
korrekt belegen (R3). Das kostet je Frage einen Modellaufruf und ist deshalb
zuschaltbar — der woechentliche Update-Lauf bleibt beim reinen Retrieval.
"""

from __future__ import annotations

import argparse
import statistics
from pathlib import Path
from time import perf_counter

import yaml
from sqlalchemy import select

from app.db.models import Document
from app.db.session import SessionLocal
from app.retrieval.search import hybrid_search


def _arxiv_map(session) -> dict[str, str | None]:
    rows = session.execute(select(Document.id, Document.meta)).all()
    return {str(did): (meta or {}).get("id") for did, meta in rows}


def evaluate(session, golden: list[dict], *, top_k: int, rerank: bool) -> dict:
    id2arxiv = _arxiv_map(session)
    hits = 0
    latencies: list[float] = []
    misses: list[str] = []
    for item in golden:
        t0 = perf_counter()
        results = hybrid_search(session, item["question"], top_k=top_k, rerank=rerank)
        latencies.append(perf_counter() - t0)
        found = {id2arxiv.get(h.document_id) for h in results}
        if item["arxiv_id"] in found:
            hits += 1
        else:
            misses.append(f"{item['arxiv_id']} ({item.get('lang', '?')}): {item['question'][:60]}")
    n = len(golden)
    return {
        "hit_rate": hits / n if n else 0.0,
        "hits": hits,
        "n": n,
        "latency_p50": statistics.median(latencies) if latencies else 0.0,
        "latency_p95": (sorted(latencies)[int(0.95 * (len(latencies) - 1))] if latencies else 0.0),
        "misses": misses,
    }


def evaluate_citations(session, golden: list[dict], *, top_k: int) -> dict:
    """Belegtreue der erzeugten Antworten (R3).

    Erzeugt je Golden-Frage eine Antwort und prueft mechanisch, ob deren Zitate
    auf die Quellen zeigen, die im Kontext lagen. Kein zweites Modell als
    Schiedsrichter — das findet keine inhaltlich falschen Aussagen, aber
    erfundene Quellen, und das ist der Fehler, der am teuersten ist.
    """
    from app.generation.generate import prepare_answer

    # Zwei Aufrufwege, zwei Sichten auf den Pfad: `python -m app.update` sieht
    # `eval` als Paket, `python eval/run_eval.py` legt stattdessen eval/ selbst
    # in den Pfad. Beides muss tragen.
    try:
        from eval.citations import check_citations
    except ModuleNotFoundError:  # pragma: no cover — nur beim direkten Skriptaufruf
        from citations import check_citations  # type: ignore[no-redef]

    zitate = gedeckt = 0
    erfunden: list[str] = []
    for item in golden:
        plan = prepare_answer(session, item["question"], top_k=top_k, rerank=False)
        antwort = plan.client.chat(plan.messages)
        pruefung = check_citations(antwort, [h.title for h in plan.hits])
        zitate += pruefung.total
        gedeckt += pruefung.grounded
        erfunden.extend(pruefung.invented)

    return {
        "citations": zitate,
        "grounded": gedeckt,
        "citation_rate": gedeckt / zitate if zitate else 1.0,
        "invented": sorted(set(erfunden))[:10],
    }


def _print(label: str, r: dict) -> None:
    print(f"\n[{label}]  Hit-Rate@k = {r['hit_rate']:.2f}  ({r['hits']}/{r['n']})")
    print(f"  latency  p50={r['latency_p50'] * 1000:.0f}ms  p95={r['latency_p95'] * 1000:.0f}ms")
    for m in r["misses"]:
        print(f"  miss: {m}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--golden", default="eval/golden.yaml")
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--with-rerank", action="store_true")
    parser.add_argument(
        "--with-citations",
        action="store_true",
        help="Belegtreue der Antworten messen (ein Modellaufruf je Frage)",
    )
    args = parser.parse_args(argv)

    golden = yaml.safe_load(Path(args.golden).read_text(encoding="utf-8"))
    with SessionLocal() as session:
        base = evaluate(session, golden, top_k=args.top_k, rerank=False)
        _print("no rerank", base)
        if args.with_rerank:
            reranked = evaluate(session, golden, top_k=args.top_k, rerank=True)
            _print("with rerank", reranked)
        if args.with_citations:
            cit = evaluate_citations(session, golden, top_k=args.top_k)
            zeile = (
                f"\n[Belegtreue]  {cit['citation_rate']:.2f}  "
                f"({cit['grounded']}/{cit['citations']} Zitate gedeckt)"
            )
            print(zeile)
            for quelle in cit["invented"]:
                print(f"  erfunden: {quelle}")

    ok = base["hit_rate"] >= 0.8
    print(f"\nDoD Hit-Rate@{args.top_k} >= 0.80: {'PASS' if ok else 'FAIL'}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
