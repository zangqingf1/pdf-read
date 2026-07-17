"""Pydantic schemas for PDF upload and parsing (F01)."""

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class PDFUploadResponse(BaseModel):
    task_id: str
    status: str = "processing"


class PDFStatusResponse(BaseModel):
    task_id: str
    status: str  # pending / processing / completed / failed
    progress: int = 0  # 0-100
    error: Optional[str] = None


class ParagraphResult(BaseModel):
    index: int
    text: str
    text_zh: str | None = None


class PDFResultResponse(BaseModel):
    document_id: str
    title: Optional[str] = None
    source: Optional[str] = None
    paragraphs: list[ParagraphResult]
    word_count: int
    paragraph_count: int


class DocumentListItem(BaseModel):
    id: str
    title: Optional[str] = None
    source: Optional[str] = None
    word_count: Optional[int] = None
    parse_status: str
    created_at: datetime


class DocumentListResponse(BaseModel):
    documents: list[DocumentListItem]
    total: int
