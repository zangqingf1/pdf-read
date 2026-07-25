"""PDF parsing via MinerU Cloud API (Precision Parsing).

Flow for local files (batch upload):
  1. POST /api/v4/file-urls/batch  →  get pre-signed upload URL + batch_id
  2. PUT PDF bytes to pre-signed URL (no Content-Type header per API spec)
  3. MinerU auto-parses the file
  4. GET /api/v4/extract-results/batch/{batch_id}  →  poll until done
  5. Download zip from full_zip_url  →  extract content_list.json + full.md
  6. Use content_list.json block types to filter headers/footers/page-numbers
"""

import asyncio
import io
import json as json_mod
import os
import re
import zipfile
from dataclasses import dataclass, field
from typing import Optional

import httpx

from app.config import settings


@dataclass
class TextBlock:
    text: str
    page_number: int = 0
    confidence: float = 0.0


@dataclass
class ParsedDocument:
    title: Optional[str] = None
    source: Optional[str] = None
    paragraphs: list[str] = field(default_factory=list)
    raw_blocks: list[TextBlock] = field(default_factory=list)
    total_pages: int = 0
    word_count: int = 0
    paragraph_page_numbers: list[int] = field(default_factory=list)


SOURCE_PATTERNS = [
    r"The Economist", r"Financial Times", r"New York Times",
    r"The Guardian", r"Wall Street Journal", r"Bloomberg",
    r"TIME", r"The Atlantic", r"The New Yorker",
]

POLL_INTERVAL = 3       # seconds between status checks
POLL_TIMEOUT = 300       # max seconds to wait for parsing

# Minimum characters for a block to be considered a paragraph (fallback)
MIN_PARAGRAPH_LEN = 15

# content_list.json block types to EXCLUDE (non-content junk)
EXCLUDED_BLOCK_TYPES = {"header", "footer", "page_number"}


def _content_list_to_paragraphs(
    content_list: list[dict], selected_pages: list[int] | None = None
) -> tuple[list[str], list[int], str | None]:
    """Convert MinerU content_list.json blocks to clean paragraphs.

    Uses block type labels to:
    - Filter out headers, footers, page numbers
    - Optionally filter to only selected pages
    - Keep titles/headings in the article (not removed)
    - Extract the first top-level title as document title

    Args:
        content_list: List of content blocks from MinerU.
        selected_pages: If provided, only keep blocks whose page_idx+1
            is in this set. None means keep all pages.

    Returns (paragraphs, page_numbers, title).
        page_numbers[i] is the 1-based page number for paragraphs[i].
    """
    paragraphs: list[str] = []
    page_numbers: list[int] = []
    title: str | None = None
    selected_set = set(selected_pages) if selected_pages else None

    for block in content_list:
        btype = block.get("type", "")

        # Read page number from MinerU (0-based page_idx → 1-based)
        page_idx = block.get("page_idx", -1)
        if isinstance(page_idx, (int, float)) and page_idx >= 0:
            page_num = int(page_idx) + 1
        else:
            page_num = 0  # Unknown page

        # Filter by selected pages
        if selected_set is not None and page_num not in selected_set:
            continue
        # Skip junk blocks (also skip page_number type blocks)
        if btype in EXCLUDED_BLOCK_TYPES:
            continue

        text = (block.get("text") or "").strip()
        if not text:
            continue

        # Clean control characters
        text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]', '', text)

        # Handle lists: join items
        if btype == "list":
            items = block.get("list_items", [])
            if items:
                text = "\n".join(item.get("text", "") for item in items if item.get("text"))
            if not text.strip():
                continue

        # Handle tables: include as HTML or text dump
        if btype == "table":
            html = block.get("table_body") or ""
            if html:
                paragraphs.append(html)
                page_numbers.append(page_num)
            elif text:
                paragraphs.append(text)
                page_numbers.append(page_num)
            continue

        # Handle code blocks
        if btype == "code":
            code = block.get("code_body") or text
            if code.strip():
                paragraphs.append(code)
                page_numbers.append(page_num)
            continue

        # Handle equations
        if btype == "equation":
            if text.strip():
                paragraphs.append(f"[公式] {text}")
                page_numbers.append(page_num)
            continue

        # --- text / title blocks ---
        text_level = block.get("text_level", 0) or 0

        # Extract first meaningful title (keep it in paragraphs too)
        if title is None and (btype == "title" or text_level >= 1):
            title = text

        paragraphs.append(text)
        page_numbers.append(page_num)

    return paragraphs, page_numbers, title


def _markdown_to_paragraphs(
    md_text: str, selected_pages: list[int] | None = None
) -> tuple[list[str], list[int], str | None]:
    """Fallback: convert markdown to paragraphs (used when content_list.json unavailable).

    Note: Markdown does not carry page information, so page_numbers is always
    empty and selected_pages filtering is not possible in this path.
    """
    # If user requested specific pages but we're in markdown fallback, warn
    if selected_pages:
        import logging
        logging.getLogger(__name__).warning(
            "Page selection requested but content_list.json unavailable — "
            "markdown fallback cannot filter by page. All pages will be included."
        )

    # Remove code blocks
    md_text = re.sub(r'```[\s\S]*?```', '', md_text)
    # Remove inline code
    md_text = re.sub(r'`[^`]+`', '', md_text)
    # Remove images
    md_text = re.sub(r'!\[.*?\]\(.*?\)', '', md_text)
    # Convert links to text only
    md_text = re.sub(r'\[([^\]]*)\]\(.*?\)', r'\1', md_text)
    # Remove horizontal rules
    md_text = re.sub(r'^[-*_]{3,}\s*$', '', md_text, flags=re.MULTILINE)
    # Remove table rows
    md_text = re.sub(r'^\s*\|.*\|\s*$', '', md_text, flags=re.MULTILINE)
    # Remove table separator lines
    md_text = re.sub(r'^[-:\s|]+$', '', md_text, flags=re.MULTILINE)

    # Split on blank lines
    raw = re.split(r'\n\s*\n', md_text)

    paragraphs = []
    title = None
    for block in raw:
        block = re.sub(r'\n+', ' ', block)
        block = re.sub(r'\s+', ' ', block).strip()
        block = re.sub(r'^#{1,6}\s+', '', block)
        block = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]', '', block)

        if len(block) >= MIN_PARAGRAPH_LEN:
            paragraphs.append(block)

    # Extract title from first short paragraph
    if paragraphs and len(paragraphs[0]) <= 120:
        title = paragraphs[0]
        # Don't remove from paragraphs — user wants it kept in article

    return paragraphs, [], title



class MinerUAPIError(Exception):
    """Raised when the MinerU Cloud API returns an error."""
    pass


class OCREngine:
    """PDF parsing via MinerU Cloud Precision Parsing API.

    Uses the batch file-upload flow (Section 2 in API docs):
    - POST /api/v4/file-urls/batch to get pre-signed upload URL + batch_id
    - PUT PDF bytes to pre-signed URL (no Content-Type header)
    - MinerU auto-parses; poll GET /api/v4/extract-results/batch/{batch_id}
    - Download the result zip and extract full.md
    """

    def __init__(self):
        self._client: httpx.AsyncClient | None = None

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=15.0))
        return self._client

    async def close(self):
        if self._client:
            await self._client.aclose()
            self._client = None

    def _auth_headers(self, api_token: str) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {api_token}",
            "Content-Type": "application/json",
        }

    async def parse_pdf(
        self, pdf_path: str, api_token: str = "", selected_pages: list[int] | None = None
    ) -> ParsedDocument:
        """Parse a PDF file using MinerU Cloud API (batch file upload flow).

        Args:
            pdf_path: Local path to the PDF file.
            api_token: MinerU API token (required — from frontend localStorage).
            selected_pages: Optional list of 1-based page numbers to include.
                If None, all pages are included.

        Returns:
            ParsedDocument with structured content.

        Raises:
            MinerUAPIError: If the API returns an error or times out.
            FileNotFoundError: If the PDF file doesn't exist.
            ValueError: If no API token is configured.
        """
        token = (api_token or "").strip()
        if not token:
            raise ValueError(
                "MinerU API Token 未配置。请点击页面右上角🔑图标设置。"
            )

        if not os.path.exists(pdf_path):
            raise FileNotFoundError(f"PDF file not found: {pdf_path}")

        base_url = settings.MINERU_API_BASE.rstrip("/")
        file_name = os.path.basename(pdf_path)

        # ── Extract selected pages locally before uploading ──
        # Saves MinerU time/credits: only the requested pages are uploaded.
        orig_selected_pages = selected_pages
        temp_pdf_path = None
        if selected_pages:
            from app.services.page_utils import extract_pdf_pages
            import logging as _logging
            _log = _logging.getLogger(__name__)
            temp_pdf_path = extract_pdf_pages(pdf_path, selected_pages)
            _log.info(
                "Page selection: %d pages extracted → uploading subset to MinerU",
                len(selected_pages),
            )
            upload_path = temp_pdf_path
            # Already physically extracted — pass None so content_list filter
            # doesn't double-filter (it would filter correctly, but this way
            # the markdown fallback also benefits).
            selected_pages = None
        else:
            upload_path = pdf_path

        # Read PDF bytes (from extracted temp file or original)
        try:
            with open(upload_path, "rb") as f:
                pdf_bytes = f.read()
        finally:
            if temp_pdf_path and os.path.exists(temp_pdf_path):
                os.unlink(temp_pdf_path)

        # ── Step 1: Request pre-signed upload URL ──
        batch_url = f"{base_url}/api/v4/file-urls/batch"
        batch_payload = {
            "files": [{"name": file_name}],
            "model_version": "vlm",  # 使用 VLM 视觉语言模型（推荐）
            "language": "en",        # 文档语言：英文
        }

        resp = await self.client.post(
            batch_url, headers=self._auth_headers(token), json=batch_payload
        )
        batch_data = self._check_response(resp, "requesting upload URL")

        # Extract batch_id and file_urls from response
        # API returns: {"code": 0, "data": {"batch_id": "...", "file_urls": ["..."]}}
        inner = batch_data.get("data", batch_data)
        batch_id = inner.get("batch_id")
        file_urls = inner.get("file_urls", [])

        if not batch_id or not file_urls:
            raise MinerUAPIError(
                f"MinerU did not return upload URL. Response: {batch_data}"
            )

        upload_url = file_urls[0] if isinstance(file_urls[0], str) else file_urls[0].get("url")
        if not upload_url:
            raise MinerUAPIError("MinerU did not return a pre-signed upload URL")

        # ── Step 2: Upload PDF to pre-signed URL ──
        # Per API docs: "上传文件时，无须设置 Content-Type 请求头"
        put_resp = await self.client.put(upload_url, content=pdf_bytes)
        if put_resp.status_code not in (200, 201, 204):
            raise MinerUAPIError(
                f"Failed to upload PDF to MinerU (HTTP {put_resp.status_code}): "
                f"{put_resp.text[:300]}"
            )

        # ── Step 3: Poll batch results for parsing completion ──
        full_md, content_list = await self._poll_batch(batch_id, token, base_url)

        # ── Step 4: Parse using content_list.json (with type labels) or fallback to markdown ──
        if content_list:
            paragraphs, page_numbers, title = _content_list_to_paragraphs(
                content_list, selected_pages
            )
            total_pages = max(page_numbers) if page_numbers else 0
        else:
            full_md = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]', '', full_md)
            paragraphs, page_numbers, title = _markdown_to_paragraphs(
                full_md, selected_pages
            )
            total_pages = 0

        source = None
        full_text = " ".join(paragraphs)
        for pattern in SOURCE_PATTERNS:
            if re.search(pattern, full_text, re.IGNORECASE):
                source = pattern
                break

        # ── Remap page numbers back to original document pages ──
        # After local extraction, MinerU sees pages 1,2,3... so its
        # page_idx values need mapping back to the user's selected pages.
        if orig_selected_pages and page_numbers:
            page_numbers = [
                orig_selected_pages[pn - 1]
                if 1 <= pn <= len(orig_selected_pages)
                else pn
                for pn in page_numbers
            ]

        word_count = sum(len(p.split()) for p in paragraphs)

        return ParsedDocument(
            title=title,
            source=source,
            paragraphs=paragraphs,
            word_count=word_count,
            total_pages=total_pages,
            paragraph_page_numbers=page_numbers,
        )

    async def _poll_batch(
        self, batch_id: str, token: str, base_url: str
    ) -> tuple[str, list[dict] | None]:
        """Poll the batch extract-results endpoint until done, then download.

        Returns (full_md_text, content_list_or_none).
        """
        headers = self._auth_headers(token)
        url = f"{base_url}/api/v4/extract-results/batch/{batch_id}"
        elapsed = 0

        while elapsed < POLL_TIMEOUT:
            await asyncio.sleep(POLL_INTERVAL)
            elapsed += POLL_INTERVAL

            resp = await self.client.get(url, headers=headers)
            data = self._check_response(resp, "polling batch status")

            inner = data.get("data", data)
            results = inner.get("extract_result", [])

            if not results:
                continue

            result = results[0]
            state = result.get("state", "")

            if state == "done":
                zip_url = result.get("full_zip_url", "")
                if not zip_url:
                    raise MinerUAPIError(
                        "MinerU task completed but no result URL returned"
                    )
                return await self._download_and_extract(zip_url)

            elif state == "failed":
                err = result.get("err_msg", "Unknown error")
                raise MinerUAPIError(f"MinerU parsing failed: {err}")

        raise MinerUAPIError(
            f"MinerU parsing timed out after {POLL_TIMEOUT}s"
        )

    async def _download_and_extract(
        self, zip_url: str
    ) -> tuple[str, list[dict] | None]:
        """Download the result zip and extract full.md + content_list.json.

        Returns (full_markdown_text, content_list_or_none).
        """
        resp = await self.client.get(zip_url)
        resp.raise_for_status()

        with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
            all_names = zf.namelist()

            # ── Find full.md ──
            md_name = None
            for name in all_names:
                if name.endswith("full.md"):
                    md_name = name
                    break
                if name.endswith(".md") and md_name is None:
                    md_name = name

            if md_name is None:
                raise MinerUAPIError(
                    f"No markdown file found in zip. Contents: {all_names[:10]}"
                )

            full_md = zf.read(md_name).decode("utf-8")

            # ── Find content_list.json ──
            content_list = None
            for name in all_names:
                if name.endswith("content_list.json"):
                    try:
                        raw = zf.read(name).decode("utf-8")
                        content_list = json_mod.loads(raw)
                        if not isinstance(content_list, list):
                            content_list = None
                    except (json_mod.JSONDecodeError, UnicodeDecodeError):
                        pass
                    break

            return full_md, content_list

    @staticmethod
    def _check_response(resp: httpx.Response, context: str) -> dict:
        """Validate API response and return parsed JSON.

        MinerU API returns HTTP 200 with {"code": 0, ...} for success.
        Business errors come as {"code": non-zero, "msg": "..."} or
        {"msgCode": "A0202", "msg": "..."}.
        """
        try:
            data = resp.json()
        except Exception:
            raise MinerUAPIError(
                f"MinerU API returned non-JSON response ({context}): "
                f"HTTP {resp.status_code}: {resp.text[:300]}"
            )

        # Check for HTTP-level errors
        if resp.status_code >= 400:
            msg = data.get("msg", str(data))
            raise MinerUAPIError(
                f"MinerU API error ({context}, HTTP {resp.status_code}): {msg}"
            )

        # Check for business-level errors (code != 0 or msgCode present)
        code = data.get("code")
        msg_code = data.get("msgCode")

        if msg_code:
            # Auth errors etc. use msgCode (e.g. "A0202")
            msg = data.get("msg", str(data))
            raise MinerUAPIError(
                f"MinerU API error ({context}): [{msg_code}] {msg}"
            )

        if code is not None and code != 0:
            msg = data.get("msg", str(data))
            raise MinerUAPIError(
                f"MinerU API error ({context}, code={code}): {msg}"
            )

        return data


# Singleton
ocr_engine = OCREngine()
