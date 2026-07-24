"""Utility for extracting page count and selected pages from PDF files using pypdf."""

import os
import tempfile
import logging

from pypdf import PdfReader, PdfWriter

logger = logging.getLogger(__name__)


def count_pdf_pages(file_path: str) -> int:
    """Return the total number of pages in a PDF file.

    Args:
        file_path: Absolute path to the PDF file on disk.

    Returns:
        Number of pages.

    Raises:
        pypdf.errors.PdfReadError: If the file is corrupted or not a valid PDF.
    """
    reader = PdfReader(file_path)
    return len(reader.pages)


def extract_pdf_pages(file_path: str, selected_pages: list[int]) -> str:
    """Extract selected pages from a PDF and write to a temporary file.

    Args:
        file_path: Path to the original PDF file.
        selected_pages: List of 1-based page numbers to extract.

    Returns:
        Path to the temporary extracted PDF file (caller must delete).

    Raises:
        FileNotFoundError: If the PDF file doesn't exist.
        pypdf.errors.PdfReadError: If the file is corrupted.
    """
    reader = PdfReader(file_path)
    writer = PdfWriter()

    total_pages = len(reader.pages)
    for page_num in selected_pages:
        if 1 <= page_num <= total_pages:
            writer.add_page(reader.pages[page_num - 1])
        else:
            logger.warning(
                "Page %d out of range (1-%d), skipping", page_num, total_pages
            )

    temp_fd, temp_path = tempfile.mkstemp(suffix=".pdf")
    with os.fdopen(temp_fd, "wb") as f:
        writer.write(f)

    logger.info(
        "Extracted %d/%d pages from %s → temp file",
        len(writer.pages), total_pages, os.path.basename(file_path),
    )
    return temp_path
