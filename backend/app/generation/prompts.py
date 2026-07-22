"""Prompt construction for RAG answers (PLAN §7 Phase 5).

Rules enforced in the system prompt: answer only from the provided context, cite each
statement as ``[Titel, Abschnitt]``, and say exactly "Dazu liegt keine Quelle vor."
when the context does not cover the question (no hallucination).
"""

from __future__ import annotations

from app.retrieval.search import SearchHit

NO_SOURCE = "Dazu liegt keine Quelle vor."

SYSTEM_PROMPT = (
    "Du bist ein präziser Assistent für ein KI-Wissensmanagement-System.\n"
    "Beantworte die Frage AUSSCHLIESSLICH auf Basis des bereitgestellten Kontexts.\n"
    "Zitiere jede Aussage mit ihrer Quelle im Format [Titel, Abschnitt].\n"
    f'Wenn der Kontext die Frage nicht abdeckt, antworte exakt: "{NO_SOURCE}"\n'
    "Erfinde keine Fakten, Zahlen oder Quellen. Antworte in der Sprache der Frage."
)


def build_context(hits: list[SearchHit]) -> str:
    blocks = []
    for i, h in enumerate(hits, start=1):
        section = h.heading or f"Chunk {i}"
        blocks.append(f"[Quelle {i}] {h.title} — {section}\n{h.content}")
    return "\n\n".join(blocks)


def build_messages(query: str, hits: list[SearchHit]) -> list[dict]:
    context = build_context(hits) if hits else "(kein Kontext gefunden)"
    user = (
        f"Kontext:\n{context}\n\n"
        f"Frage: {query}\n\n"
        "Antworte nur mit belegten Aussagen und nenne die Quellen."
    )
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user},
    ]
