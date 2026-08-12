"""Supported file-type constants and inference helpers.

Shared by the upload validation (pdf_service), the OCR engine
(model_version selection), and the parse-url endpoint.

MinerU Cloud API supported inputs:
  PDF / DOC / DOCX / PPT / PPTX / XLS / XLSX /
  images (png jpg jpeg jp2 webp gif bmp) / HTML
"""

from urllib.parse import urlparse

# File extensions we accept for direct upload.
SUPPORTED_UPLOAD_EXTENSIONS = {
    ".pdf", ".doc", ".docx", ".ppt", ".pptx",
    ".xls", ".xlsx",
    ".png", ".jpg", ".jpeg", ".jp2", ".webp", ".gif", ".bmp",
    ".html",
}

# Only PDF has a "page" concept (page count + page selection).
PAGE_BASED_EXTENSIONS = {".pdf"}

# HTML documents must be parsed with the MinerU-HTML model.
HTML_EXTENSIONS = {".html"}

MODEL_VERSION_VLM = "vlm"
MODEL_VERSION_HTML = "MinerU-HTML"

def normalize_ext(name_or_url: str) -> str:
    """Extract a lowercase extension (with dot) from a file name or URL path.

    Query strings and fragments are ignored. Returns "" when there is no
    suffix (e.g. a bare host like "https://example.com").
    """
    raw = (name_or_url or "").strip()
    if not raw:
        return ""

    # For URLs, only the path component carries a file extension (avoids
    # treating the host's TLD — example.com → "com" — as an extension).
    if "://" in raw or raw.startswith("//"):
        path = urlparse(raw).path
    else:
        path = raw

    # Strip any query/fragment on plain file names too (e.g. "file.pdf#frag").
    path = path.split("?", 1)[0].split("#", 1)[0]
    if not path or path.endswith("/"):
        return ""

    last_seg = path.rsplit("/", 1)[-1]
    if not last_seg or last_seg.startswith(".") or last_seg.endswith(".") or "." not in last_seg:
        return ""
    stem, _dot, ext = last_seg.rpartition(".")
    if not stem:
        return ""
    return "." + ext.lower()


def is_supported_extension(ext: str) -> bool:
    """Whether an extension (with dot) is in the upload whitelist."""
    return ext in SUPPORTED_UPLOAD_EXTENSIONS


def infer_model_version(name_or_url: str) -> str:
    """Pick MinerU model_version from a file name or URL.

    Known file suffixes → vlm (VLM precision parsing).
    Unknown suffix / no suffix / HTML → MinerU-HTML (web page fallback).
    """
    ext = normalize_ext(name_or_url)
    if ext and ext in SUPPORTED_UPLOAD_EXTENSIONS and ext not in HTML_EXTENSIONS:
        return MODEL_VERSION_VLM
    return MODEL_VERSION_HTML
