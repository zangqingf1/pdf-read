"""PDF processing business logic — upload, parse, filter, structure.

Follows TECH_DESING.md section 3.2 — F01 PDF import and text extraction.
"""

import asyncio
import ipaddress
import json
import os
import socket
import uuid
import logging
from datetime import datetime
from typing import Optional
from urllib.parse import urlparse

import aiofiles
from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.document import Document
from app.models.paragraph import Paragraph
from app.services.file_types import (
    PAGE_BASED_EXTENSIONS,
    SUPPORTED_UPLOAD_EXTENSIONS,
    normalize_ext,
)
from app.services.ocr_engine import OCREngine, ParsedDocument, ocr_engine
from app.services.page_utils import count_pdf_pages

logger = logging.getLogger(__name__)

_RESTRICTED_IP = (
    "is_private",
    "is_loopback",
    "is_link_local",
    "is_multicast",
    "is_reserved",
    "is_unspecified",
)


def _is_restricted_ip(addr: ipaddress._BaseAddress) -> bool:
    """Reject private, loopback, link-local, metadata and other non-public IPs."""
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped is not None:
        addr = addr.ipv4_mapped
    return any(getattr(addr, attr, False) for attr in _RESTRICTED_IP)


def _read_pdf_page_dims(file_path: str) -> dict[int, tuple[float, float, float]]:
    """Read every page's PDF-point size + MinerU render scale (sync, call via to_thread)."""
    from pypdf import PdfReader

    render_dpi = 200.0
    max_render_side = 3500.0
    page_pts_map: dict[int, tuple[float, float, float]] = {}
    reader = PdfReader(file_path)
    for i, pg in enumerate(reader.pages, start=1):
        mb = pg.mediabox
        w, h = float(mb.width), float(mb.height)
        # 与 MinerU page_to_image 一致的渲染缩放（含长边钳制）
        scale = min(render_dpi / 72.0, max_render_side / max(w, h))
        page_pts_map[i] = (w, h, scale)
    return page_pts_map


async def _validate_public_http_url(url: str) -> None:
    """Ensure a URL targets a public http(s) host (SSRF guard).

    Checks the literal host and every resolved address. DNS resolution is
    done through the event loop so the async worker is not blocked.
    """
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("仅支持 http/https 链接")

    hostname = parsed.hostname
    if hostname == "localhost" or hostname.endswith(".local"):
        raise ValueError("仅支持公网 http/https 链接")

    try:
        literal = ipaddress.ip_address(hostname)
        if _is_restricted_ip(literal):
            raise ValueError("仅支持公网 http/https 链接")
    except ValueError as exc:
        # Non-IP literal — resolve below; re-raise only for the guard above.
        if isinstance(exc, ValueError) and str(exc) == "仅支持公网 http/https 链接":
            raise

    try:
        infos = await asyncio.get_running_loop().getaddrinfo(
            hostname, None, type=socket.SOCK_STREAM
        )
    except OSError:
        raise ValueError("仅支持公网 http/https 链接")

    for info in infos:
        try:
            addr = ipaddress.ip_address(info[4][0])
        except ValueError:
            continue
        if _is_restricted_ip(addr):
            raise ValueError("仅支持公网 http/https 链接")


class PDFService:
    """PDF handling business logic.

    Responsibilities:
    - File validation and storage
    - Orchestrate OCR parsing
    - Filter non-content blocks
    - Reconstruct paragraphs
    - Save structured result to database
    """

    MAX_FILE_SIZE = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024

    def __init__(self, ocr: OCREngine | None = None):
        self.ocr = ocr or ocr_engine

    async def upload_and_save(
        self, file: UploadFile, db: AsyncSession, user_id: uuid.UUID | None = None
    ) -> Document:
        """Validate, save, and create a Document record in the database.

        Accepts any MinerU-supported file type (PDF / Word / PPT / Excel /
        images / HTML).

        Args:
            file: The uploaded document file.
            db: Database session.
            user_id: The owning user's ID (required for data isolation).

        Returns:
            The created Document (status=pending).

        Raises:
            ValueError: If file validation fails.
        """
        # Extension whitelist (replaces the PDF-only content-type gate).
        filename = file.filename or "untitled"
        ext = normalize_ext(filename)
        if ext not in SUPPORTED_UPLOAD_EXTENSIONS:
            raise ValueError(
                f"不支持的文件类型：{ext or '无扩展名'}。"
                "支持的格式：PDF、Word、PPT、Excel、图片与 HTML"
            )

        # Save to disk with the real extension, streaming in chunks so a
        # 50MB upload is never buffered fully in memory per request.
        os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
        file_id = uuid.uuid4()
        file_path = os.path.join(settings.UPLOAD_DIR, f"{file_id}{ext}")

        size = 0
        first_chunk = b""
        try:
            async with aiofiles.open(file_path, "wb") as f:
                while True:
                    chunk = await file.read(1024 * 1024)
                    if not chunk:
                        break
                    if not first_chunk:
                        first_chunk = chunk
                    size += len(chunk)
                    if size > self.MAX_FILE_SIZE:
                        raise ValueError(
                            f"File size exceeds maximum "
                            f"({settings.MAX_UPLOAD_SIZE_MB}MB)"
                        )
                    await f.write(chunk)
        except Exception:
            try:
                os.remove(file_path)
            except OSError:
                pass
            raise

        if size == 0:
            try:
                os.remove(file_path)
            except OSError:
                pass
            raise ValueError("Empty file uploaded")

        # Keep the PDF magic-number check so a renamed docx isn't accepted as
        # PDF (page-count and page-selection flows depend on real PDFs).
        if ext == ".pdf" and not first_chunk.startswith(b"%PDF"):
            try:
                os.remove(file_path)
            except OSError:
                pass
            raise ValueError("扩展名为 .pdf 但内容不是有效 PDF 文件")

        # Count pages only for PDF (other types have no page concept)
        page_count = None
        if ext in PAGE_BASED_EXTENSIONS:
            try:
                page_count = await asyncio.to_thread(count_pdf_pages, file_path)
            except Exception as e:
                logger.warning("Could not count PDF pages: %s", e)

        # Create document record
        document = Document(
            id=file_id,
            title=os.path.splitext(filename)[0],
            file_path=file_path,
            original_text="",  # Will be filled after parsing
            parse_status="pending",
            page_count=page_count,
            source_type="upload",
            file_ext=ext,
            user_id=user_id,
            created_at=datetime.now(),  # Use local time, not SQLite UTC default
        )
        db.add(document)
        await db.flush()

        return document

    async def save_url_document(
        self, url: str, db: AsyncSession, user_id: uuid.UUID | None = None
    ) -> Document:
        """Register a URL (file link or web page) for parsing.

        The URL is handed to MinerU's /extract/task directly — MinerU fetches it
        server-side (file URLs use vlm, HTML pages use MinerU-HTML). No local
        copy is downloaded; `source_url` is stored for retries.

        Raises:
            ValueError: If the URL scheme is not http/https.
        """
        await _validate_public_http_url(url)
        parsed = urlparse(url)

        # Extension for display/model hint; unknown suffix → treat as web page.
        ext = normalize_ext(url) or ".html"

        # Title: URL basename without extension, else hostname
        base = os.path.basename(parsed.path)
        title = os.path.splitext(base)[0] or (parsed.netloc or "untitled")

        document = Document(
            id=uuid.uuid4(),
            title=title,
            file_path=None,  # URL 源不留本地副本，MinerU 直接抓取
            original_text="",
            parse_status="pending",
            page_count=None,  # URL sources skip page selection
            source_type="url",
            file_ext=ext,
            source_url=url,
            user_id=user_id,
            created_at=datetime.now(),
        )
        db.add(document)
        await db.flush()

        return document

    async def parse_document(
        self,
        document_id: uuid.UUID,
        db: AsyncSession,
        mineru_token: str = "",
        *,
        release_lock_before_ocr: bool = False,
    ) -> Document:
        """Run OCR parsing on a document and save structured results.

        ``release_lock_before_ocr`` commits the ``processing`` status before
        the long-running MinerU call so SQLite's single-writer lock is not
        held for the whole parse. Background/Celery tasks pass True.
        """
        # Get document
        stmt = select(Document).where(Document.id == document_id)
        result = await db.execute(stmt)
        document = result.scalar_one()

        # Update status
        document.parse_status = "processing"
        await db.flush()
        if release_lock_before_ocr:
            # 先结束写事务，MinerU 数分钟网络解析期间不占用 SQLite 写锁。
            await db.commit()

        try:
            # Run OCR via MinerU Cloud API.
            # URL sources (file link OR web page) are fetched by MinerU itself
            # via /extract/task; uploaded files go through the batch flow.
            if document.source_type == "url" and document.source_url:
                parsed: ParsedDocument = await self.ocr.parse_url(
                    document.source_url,
                    api_token=mineru_token,
                )
            else:
                parsed: ParsedDocument = await self.ocr.parse_file(
                    document.file_path,
                    api_token=mineru_token,
                    selected_pages=document.selected_pages,
                )

            # Update document metadata
            document.title = parsed.title or document.title
            document.source = parsed.source
            document.original_text = "\n\n".join(parsed.paragraphs)
            document.paragraph_count = len(parsed.paragraphs)
            document.word_count = parsed.word_count
            document.page_count = document.page_count or parsed.total_pages
            document.parse_status = "completed"

            # ── Layout boxes: PDF uploads only ──
            # MinerU bbox is in render-image pixels. MinerU renders pages with
            # pypdfium2 at dpi=200 (scale=200/72), clamped so the image long
            # side never exceeds 3500px (mineru/utils/pdf_reader.py). Store the
            # exact per-page render scale together with the page's PDF-point
            # size so the frontend can map boxes without guessing the DPI.
            page_nums = parsed.paragraph_page_numbers
            bboxes = getattr(parsed, "paragraph_bboxes", []) or []
            page_pts_map: dict[int, tuple[float, float, float]] = {}  # page -> (w, h, scale)
            needs_dims = any(
                bbox is not None and page_nums[i] is not None
                for i, bbox in enumerate(bboxes)
                if i < len(page_nums)
            )
            is_pdf = (document.file_ext or "").lower() == ".pdf"
            if needs_dims and is_pdf and document.file_path:
                try:
                    page_pts_map = await asyncio.to_thread(
                        _read_pdf_page_dims, document.file_path
                    )
                except Exception:
                    logger.warning(
                        "Could not read PDF page dimensions for layout boxes "
                        "(document %s)", document.id, exc_info=True,
                    )

            paragraphs_to_add: list[Paragraph] = []
            for idx, text in enumerate(parsed.paragraphs):
                page_num = page_nums[idx] if idx < len(page_nums) else None
                bbox = bboxes[idx] if idx < len(bboxes) else None
                bbox_json = None
                if bbox is not None and page_num is not None and page_num in page_pts_map:
                    w, h, scale = page_pts_map[page_num]
                    bbox_json = json.dumps(
                        {"box": bbox, "pts_w": w, "pts_h": h, "scale": scale}
                    )
                paragraphs_to_add.append(Paragraph(
                    document_id=document.id,
                    index=idx,
                    text_en=text,
                    page_number=page_num,
                    bbox_json=bbox_json,
                ))

            db.add_all(paragraphs_to_add)
            await db.flush()

        except Exception as e:
            document.parse_status = "failed"
            document.error_message = str(e)[:500]
            await db.flush()
            raise e

        return document

    async def get_document(
        self,
        document_id: uuid.UUID,
        db: AsyncSession,
        user_id: uuid.UUID | None = None,
        load_paragraphs: bool = False,
    ) -> Optional[Document]:
        """Get a document by ID, optionally eager-loading paragraphs.

        ``load_paragraphs`` is off by default: status/file/title/delete 等
        端点不需要段落，避免把几百段文本全部拉进内存。
        """
        from sqlalchemy.orm import selectinload

        stmt = select(Document).where(Document.id == document_id)
        if load_paragraphs:
            stmt = stmt.options(selectinload(Document.paragraphs))
        if user_id is not None:
            stmt = stmt.where(Document.user_id == user_id)
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    async def list_documents(
        self, db: AsyncSession, limit: int = 20, offset: int = 0,
        user_id: uuid.UUID | None = None,
        favorites_only: bool = False,
    ) -> tuple[list[Document], int]:
        """List documents ordered by creation time (newest first).

        If user_id is provided, only documents owned by that user are returned.
        If favorites_only is True, only favorited documents are returned
        (total reflects the filtered count).
        """
        from sqlalchemy import func as sqlfunc
        from sqlalchemy.orm import defer

        # Count total
        count_stmt = select(sqlfunc.count()).select_from(Document)
        if user_id is not None:
            count_stmt = count_stmt.where(Document.user_id == user_id)
        if favorites_only:
            count_stmt = count_stmt.where(Document.is_favorite.is_(True))
        total_result = await db.execute(count_stmt)
        total = total_result.scalar_one()

        # Fetch page — 列表不需要 original_text 整篇正文
        stmt = (
            select(Document)
            .options(defer(Document.original_text))
            .order_by(Document.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        if user_id is not None:
            stmt = stmt.where(Document.user_id == user_id)
        if favorites_only:
            stmt = stmt.where(Document.is_favorite.is_(True))
        result = await db.execute(stmt)
        documents = result.scalars().all()

        return list(documents), total

    def filter_non_content(self, blocks: list) -> list:
        """Filter non-content blocks (headers, footers, ads, page numbers).

        Implemented in the OCREngine._build_document method.
        This is a passthrough for the service layer.
        """
        return [
            b for b in blocks
            if b.block_type.value not in ("header", "footer", "advertisement", "page_number")
        ]

    def reconstruct_paragraphs(self, blocks: list) -> list[str]:
        """Reconstruct paragraphs from text blocks in reading order.

        Implemented in the OCREngine._build_document method.
        This is a passthrough for the service layer.
        """
        text = " ".join(b.text for b in blocks)
        return text.split("\n\n")


# Singleton instance
pdf_service = PDFService()
