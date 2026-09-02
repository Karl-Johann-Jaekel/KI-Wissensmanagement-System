"""Belegtreue-Prüfung der Eval (R3). Reine Logik, keine Datenbank, kein Modell.

Liegt bei den Backend-Tests, weil pytest nur dort sucht (testpaths).
"""

from __future__ import annotations

from eval.citations import check_citations


def test_citation_matching_source_counts_as_grounded() -> None:
    check = check_citations(
        "Self-Attention gewichtet Positionen [Attention Is All You Need, Model].",
        ["Attention Is All You Need"],
    )
    assert check.total == 1
    assert check.grounded == 1
    assert check.rate == 1.0


def test_shortened_title_still_counts() -> None:
    """Modelle kuerzen lange Titel — das ist kein erfundener Beleg."""
    check = check_citations(
        "… [Retrieval-Augmented Generation for Knowledge, Abstract].",
        ["Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks"],
    )
    assert check.grounded == 1


def test_invented_source_is_caught() -> None:
    """Der teuerste Fehler: eine Quelle, die es im Kontext nicht gab."""
    check = check_citations(
        "… [Attention Is All You Need, Model] und [Erfundenes Paper 2031, S. 4].",
        ["Attention Is All You Need"],
    )
    assert check.total == 2
    assert check.grounded == 1
    assert check.invented == ["Erfundenes Paper 2031"]
    assert check.rate == 0.5


def test_answer_without_citations_is_not_penalised() -> None:
    """'Dazu liegt keine Quelle vor.' ist eine korrekte Antwort ohne Beleg."""
    check = check_citations("Dazu liegt keine Quelle vor.", ["Irgendein Paper"])
    assert check.total == 0
    assert check.rate == 1.0


def test_section_is_optional() -> None:
    check = check_citations("… [Attention Is All You Need].", ["Attention Is All You Need"])
    assert check.grounded == 1
