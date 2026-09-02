"""Belegtreue einer Antwort — prüft, ob Zitate auf gelieferte Quellen zeigen.

Die Golden-Eval misst bisher nur Hit-Rate@k: kommt das erwartete Paper unter die
Treffer. Ob die *Antwort* die Treffer dann korrekt belegt, misst nichts — obwohl
PLAN §11 Halluzination als Risiko führt und der System-Prompt jede Aussage mit
``[Titel, Abschnitt]`` belegen lässt.

Hier wird das rein mechanisch geprüft, ohne zweites Modell als Schiedsrichter:
Ein Zitat gilt als gedeckt, wenn sein Titelteil zu einem der Dokumente passt, die
dem Modell im Kontext vorlagen. Das findet keine inhaltlich falschen Aussagen —
aber es findet erfundene Quellen, und das ist der Fehler, der am teuersten ist.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

#: [Titel, Abschnitt] — Abschnitt ist optional, manche Modelle lassen ihn weg.
_CITATION = re.compile(r"\[([^\[\]]+?)(?:,\s*([^\[\]]*))?\]")

#: Titel werden gekürzt zitiert. Ab dieser Länge gilt ein Präfix als Treffer.
_MIN_PREFIX = 12


@dataclass(frozen=True)
class CitationCheck:
    total: int
    grounded: int
    invented: list[str]

    @property
    def rate(self) -> float:
        """Anteil gedeckter Zitate. Ohne Zitat gilt die Antwort als gedeckt."""
        return self.grounded / self.total if self.total else 1.0


def _normalise(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def check_citations(answer: str, source_titles: list[str]) -> CitationCheck:
    """Zitate der Antwort gegen die gelieferten Quellentitel halten."""
    sources = [_normalise(t) for t in source_titles if t]
    grounded = 0
    invented: list[str] = []

    citations = _CITATION.findall(answer)
    for raw_title, _section in citations:
        cited = _normalise(raw_title)
        if not cited:
            continue
        # Ein Zitat deckt, wenn es Präfix eines Quellentitels ist oder umgekehrt.
        # Modelle kürzen lange Titel — "Attention Is All You" statt des ganzen.
        if any(
            src.startswith(cited) or cited.startswith(src)
            for src in sources
            if len(cited) >= _MIN_PREFIX or len(src) >= _MIN_PREFIX
        ):
            grounded += 1
        else:
            invented.append(raw_title.strip())

    return CitationCheck(total=len(citations), grounded=grounded, invented=invented)
