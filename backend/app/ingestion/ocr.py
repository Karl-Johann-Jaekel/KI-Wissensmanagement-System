"""PDF -> Markdown via Docling (PLAN §4: local, default parser).

Docling is a heavy dependency (torch etc.) and downloads layout models on first use,
so it is imported lazily and the converter is cached. Only ``to_markdown`` needs it;
the rest of the app and the test suite import fine without Docling loaded.

OCR is **off by default**: arXiv papers are born-digital, their text layer is already
there, and the OCR stage was the memory peak that got the ingest process OOM-killed
on a 40-paper run. Set ``DOCLING_OCR=true`` for scanned documents.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.core.config import get_settings

_converter: Any = None


def _get_converter() -> Any:
    global _converter
    if _converter is None:
        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.pipeline_options import PdfPipelineOptions
        from docling.document_converter import DocumentConverter, PdfFormatOption

        settings = get_settings()
        options = PdfPipelineOptions()
        options.do_ocr = settings.docling_ocr
        options.do_table_structure = settings.docling_table_structure
        _converter = DocumentConverter(
            format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)}
        )
    return _converter


def to_markdown(pdf_path: str | Path) -> str:
    """Convert a (born-digital) PDF to Markdown."""
    result = _get_converter().convert(str(pdf_path))
    return result.document.export_to_markdown()
