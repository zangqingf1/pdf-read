"""PDF processing business logic — upload, parse, filter, structure.

Follows TECH_DESING.md section 3.2 — F01 PDF import and text extraction.
"""

import os
import uuid
import logging
from datetime import datetime
from typing import Optional

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.document import Document
from app.models.paragraph import Paragraph
from app.services.ocr_engine import OCREngine, ParsedDocument, ocr_engine
from app.services.page_utils import count_pdf_pages

logger = logging.getLogger(__name__)


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

        Args:
            file: The uploaded PDF file.
            db: Database session.
            user_id: The owning user's ID (required for data isolation).

        Returns:
            The created Document (status=pending).

        Raises:
            ValueError: If file validation fails.
        """
        # Validate content
        content = await file.read()

        if len(content) == 0:
            raise ValueError("Empty file uploaded")

        if len(content) > self.MAX_FILE_SIZE:
            raise ValueError(
                f"File size ({len(content) / 1024 / 1024:.1f}MB) exceeds "
                f"maximum ({settings.MAX_UPLOAD_SIZE_MB}MB)"
            )

        # Validate PDF magic number
        if not content.startswith(b"%PDF"):
            raise ValueError("File is not a valid PDF (missing PDF header)")

        # Save to disk
        os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
        file_id = uuid.uuid4()
        file_path = os.path.join(settings.UPLOAD_DIR, f"{file_id}.pdf")

        with open(file_path, "wb") as f:
            f.write(content)

        # Count pages using pypdf (fast local read)
        page_count = None
        try:
            page_count = count_pdf_pages(file_path)
        except Exception as e:
            logger.warning("Could not count PDF pages: %s", e)

        # Create document record
        safe_filename = file.filename or "untitled.pdf"
        document = Document(
            id=file_id,
            title=safe_filename.replace(".pdf", ""),
            file_path=file_path,
            original_text="",  # Will be filled after parsing
            parse_status="pending",
            page_count=page_count,
            user_id=user_id,
            created_at=datetime.now(),  # Use local time, not SQLite UTC default
        )
        db.add(document)
        await db.flush()

        return document

    async def parse_document(
        self, document_id: uuid.UUID, db: AsyncSession, mineru_token: str = ""
    ) -> Document:
        """Run OCR parsing on a document and save structured results.

        Args:
            document_id: The document to parse.
            db: Database session.
            mineru_token: Optional MinerU API token override.

        Returns:
            The updated Document with paragraphs populated.
        """
        # Get document
        stmt = select(Document).where(Document.id == document_id)
        result = await db.execute(stmt)
        document = result.scalar_one()

        # Update status
        document.parse_status = "processing"
        await db.flush()

        try:
            # Run OCR via MinerU Cloud API
            parsed: ParsedDocument = await self.ocr.parse_pdf(
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

            # Create paragraph records with page numbers
            page_nums = parsed.paragraph_page_numbers
            for idx, text in enumerate(parsed.paragraphs):
                page_num = page_nums[idx] if idx < len(page_nums) else None
                paragraph = Paragraph(
                    document_id=document.id,
                    index=idx,
                    text_en=text,
                    page_number=page_num,
                )
                db.add(paragraph)

            await db.flush()

        except Exception as e:
            document.parse_status = "failed"
            document.error_message = str(e)[:500]
            await db.flush()
            raise e

        return document

    async def get_document(
        self, document_id: uuid.UUID, db: AsyncSession,
        user_id: uuid.UUID | None = None,
    ) -> Optional[Document]:
        """Get a document by ID with paragraphs loaded.

        If user_id is provided, the query is scoped to that user (data isolation).
        """
        from sqlalchemy.orm import selectinload

        stmt = (
            select(Document)
            .where(Document.id == document_id)
            .options(selectinload(Document.paragraphs))
        )
        if user_id is not None:
            stmt = stmt.where(Document.user_id == user_id)
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    async def list_documents(
        self, db: AsyncSession, limit: int = 20, offset: int = 0,
        user_id: uuid.UUID | None = None,
    ) -> tuple[list[Document], int]:
        """List documents ordered by creation time (newest first).

        If user_id is provided, only documents owned by that user are returned.
        """
        from sqlalchemy import func as sqlfunc

        # Count total
        count_stmt = select(sqlfunc.count()).select_from(Document)
        if user_id is not None:
            count_stmt = count_stmt.where(Document.user_id == user_id)
        total_result = await db.execute(count_stmt)
        total = total_result.scalar_one()

        # Fetch page
        stmt = (
            select(Document)
            .order_by(Document.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        if user_id is not None:
            stmt = stmt.where(Document.user_id == user_id)
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
