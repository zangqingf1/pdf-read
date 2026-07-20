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


class WordAnalysisItem(BaseModel):
    id: str
    paragraph_index: int
    word: str
    phonetic: str = ""
    part_of_speech: str = ""
    definition: str = ""
    definition_zh: str = ""
    example_sentences: list[str] = Field(default_factory=list)
    example_sentences_zh: list[str] = Field(default_factory=list)


class PDFResultResponse(BaseModel):
    document_id: str
    title: Optional[str] = None
    source: Optional[str] = None
    paragraphs: list[ParagraphResult]
    word_count: int
    paragraph_count: int
    word_analyses: list[WordAnalysisItem] = Field(default_factory=list)
    sentence_analyses: list = Field(default_factory=list)


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
