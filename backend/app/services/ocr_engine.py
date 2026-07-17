"""PDF parsing via MinerU Cloud API (Precision Parsing).

Flow for local files (batch upload):
  1. POST /api/v4/file-urls/batch  →  get pre-signed upload URL + batch_id
  2. PUT PDF bytes to pre-signed URL (no Content-Type header per API spec)
  3. MinerU auto-parses the file
  4. GET /api/v4/extract-results/batch/{batch_id}  →  poll until done
  5. Download zip from full_zip_url  →  extract full.md
  6. Convert markdown → clean paragraphs
"""

import asyncio
import io
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


SOURCE_PATTERNS = [
    r"The Economist", r"Financial Times", r"New York Times",
    r"The Guardian", r"Wall Street Journal", r"Bloomberg",
    r"TIME", r"The Atlantic", r"The New Yorker",
]

POLL_INTERVAL = 3       # seconds between status checks
POLL_TIMEOUT = 300       # max seconds to wait for parsing


def _extract_title_and_source(paragraphs: list[str]) -> tuple[Optional[str], Optional[str]]:
    title = None
    if len(paragraphs) > 1 and len(paragraphs[0].strip()) <= 100:
        title = paragraphs[0].strip()

    source = None
    full_text = " ".join(paragraphs)
    for pattern in SOURCE_PATTERNS:
        if re.search(pattern, full_text, re.IGNORECASE):
            source = pattern
            break
    return title, source


def _markdown_to_paragraphs(md_text: str) -> list[str]:
    """Convert MinerU markdown output to clean plain-text paragraphs."""
    md_text = re.sub(r'```[\s\S]*?```', '', md_text)
    md_text = re.sub(r'`[^`]+`', '', md_text)
    md_text = re.sub(r'!\[.*?\]\(.*?\)', '', md_text)
    md_text = re.sub(r'\[([^\]]*)\]\(.*?\)', r'\1', md_text)
    md_text = re.sub(r'^#{1,6}\s+', '', md_text, flags=re.MULTILINE)
    md_text = re.sub(r'\*\*([^*]+)\*\*', r'\1', md_text)
    md_text = re.sub(r'\*([^*]+)\*', r'\1', md_text)
    md_text = re.sub(r'^[-*_]{3,}\s*$', '', md_text, flags=re.MULTILINE)
    md_text = re.sub(r'\|', ' ', md_text)
    md_text = re.sub(r'^[-:\s|]+$', '', md_text, flags=re.MULTILINE)

    raw = re.split(r'\n\s*\n', md_text)
    paragraphs = []
    for p in raw:
        p = re.sub(r'\n+', ' ', p)
        p = re.sub(r'\s+', ' ', p).strip()
        # Remove control characters that break JSON serialization
        # (U+0000-U+001F except \t, \n, \r which were already handled)
        p = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]', '', p)
        if len(p) >= 10:
            paragraphs.append(p)
    return paragraphs


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

    async def parse_pdf(self, pdf_path: str, api_token: str = "") -> ParsedDocument:
        """Parse a PDF file using MinerU Cloud API (batch file upload flow).

        Args:
            pdf_path: Local path to the PDF file.
            api_token: MinerU API token (overrides settings.MINERU_API_TOKEN).

        Returns:
            ParsedDocument with structured content.

        Raises:
            MinerUAPIError: If the API returns an error or times out.
            FileNotFoundError: If the PDF file doesn't exist.
            ValueError: If no API token is configured.
        """
        token = (api_token or settings.MINERU_API_TOKEN).strip()
        if not token:
            raise ValueError(
                "MinerU API Token 未配置。请在 .env 中设置 MINERU_API_TOKEN 或在页面右上角配置。"
            )

        if not os.path.exists(pdf_path):
            raise FileNotFoundError(f"PDF file not found: {pdf_path}")

        base_url = settings.MINERU_API_BASE.rstrip("/")
        file_name = os.path.basename(pdf_path)

        # Read PDF bytes
        with open(pdf_path, "rb") as f:
            pdf_bytes = f.read()

        # ── Step 1: Request pre-signed upload URL ──
        batch_url = f"{base_url}/api/v4/file-urls/batch"
        batch_payload = {"files": [{"name": file_name}]}

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
        md_content = await self._poll_batch(batch_id, token, base_url)

        # ── Step 4: Convert markdown to paragraphs ──
        paragraphs = _markdown_to_paragraphs(md_content)

        title, source = _extract_title_and_source(paragraphs)
        if title:
            paragraphs = paragraphs[1:]

        full_text = " ".join(paragraphs)

        return ParsedDocument(
            title=title,
            source=source,
            paragraphs=paragraphs,
            word_count=len(full_text.split()),
        )

    async def _poll_batch(self, batch_id: str, token: str, base_url: str) -> str:
        """Poll the batch extract-results endpoint until done, then download.

        Uses GET /api/v4/extract-results/batch/{batch_id}
        Response: {"code": 0, "data": {"extract_result": [{...}]}}

        Returns the extracted markdown text.
        """
        headers = self._auth_headers(token)
        url = f"{base_url}/api/v4/extract-results/batch/{batch_id}"
        elapsed = 0

        while elapsed < POLL_TIMEOUT:
            await asyncio.sleep(POLL_INTERVAL)
            elapsed += POLL_INTERVAL

            resp = await self.client.get(url, headers=headers)
            data = self._check_response(resp, "polling batch status")

            # Unwrap data envelope
            inner = data.get("data", data)
            results = inner.get("extract_result", [])

            if not results:
                # No results yet, continue polling
                continue

            # Single file upload → first (and only) result
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

            # else: pending / running / converting / waiting-file — continue polling

        raise MinerUAPIError(
            f"MinerU parsing timed out after {POLL_TIMEOUT}s"
        )

    async def _download_and_extract(self, zip_url: str) -> str:
        """Download the result zip and extract full.md content."""
        resp = await self.client.get(zip_url)
        resp.raise_for_status()

        with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
            # Find full.md (may be at root or in a subdirectory)
            md_name = None
            for name in zf.namelist():
                if name.endswith("full.md") or name.endswith(".md"):
                    # Prefer full.md over other .md files
                    if name.endswith("full.md"):
                        md_name = name
                        break
                    if md_name is None:
                        md_name = name

            if md_name is None:
                files = zf.namelist()
                raise MinerUAPIError(
                    f"No markdown file found in zip. Contents: {files[:10]}"
                )

            return zf.read(md_name).decode("utf-8")

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
