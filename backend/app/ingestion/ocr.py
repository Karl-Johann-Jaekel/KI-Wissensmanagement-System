"""PDF -> Markdown via Docling (PLAN §4: local, default parser).

Docling is a heavy dependency (torch etc.) and downloads layout models on first use,
so it is imported lazily and the converter is cached. Only ``to_markdown`` needs it;
the rest of the app and the test suite import fine without Docling loaded.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

_converter: Any = None


def _get_converter() -> Any:
    global _converter
    if _converter is None:
        from docling.document_converter import DocumentConverter

        _converter = DocumentConverter()
    return _converter


def to_markdown(pdf_path: str | Path) -> str:
    """Convert a (born-digital) PDF to Markdown."""
    result = _get_converter().convert(str(pdf_path))
    return result.document.export_to_markdown()
