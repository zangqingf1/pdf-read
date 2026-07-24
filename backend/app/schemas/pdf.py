"""Pydantic schemas for PDF upload and parsing (F01)."""

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class PDFUploadResponse(BaseModel):
    task_id: str
    status: str = "processing"
    page_count: int | None = None


class PDFStatusResponse(BaseModel):
    task_id: str
    status: str  # pending / processing / completed / failed / awaiting_selection
    progress: int = 0  # 0-100
    error: Optional[str] = None
    page_count: int | None = None
    selected_pages: list[int] | None = None


class ParagraphResult(BaseModel):
    index: int
    text: str
    text_zh: str | None = None
    page_number: int | None = None


class WordAnalysisItem(BaseModel):
    id: str
    paragraph_index: int
    word: str
    phonetic: str = ""
    part_of_speech: str = ""
    definition: str = ""
    definition_zh: str = ""
    cognates: list[dict] = Field(default_factory=list)
    synonyms_antonyms: dict = Field(default_factory=lambda: {"synonyms": [], "antonyms": []})
    base_form: str = ""
    plural_form: str = ""


class PDFResultResponse(BaseModel):
    document_id: str
    title: Optional[str] = None
    source: Optional[str] = None
    paragraphs: list[ParagraphResult]
    word_count: int
    paragraph_count: int
    word_analyses: list[WordAnalysisItem] = Field(default_factory=list)
    sentence_analyses: list = Field(default_factory=list)
    page_count: int | None = None
    selected_pages: list[int] | None = None


class SelectPagesRequest(BaseModel):
    task_id: str
    selected_pages: list[int] | None = Field(
        default=None, max_length=10
    )  # None = parse all pages
    mineru_token: str = ""  # User's MinerU token (from frontend localStorage)


class SelectPagesResponse(BaseModel):
    task_id: str
    status: str
    selected_pages: list[int]
    message: str


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


class UpdateParagraphItem(BaseModel):
    index: int
    text_en: str = Field(..., min_length=0, max_length=50000)


class UpdateParagraphsRequest(BaseModel):
    paragraphs: list[UpdateParagraphItem]


class UpdateParagraphsResponse(BaseModel):
    document_id: str
    updated_count: int


class DeleteParagraphResponse(BaseModel):
    document_id: str
    deleted_index: int
    message: str


class MergeParagraphsRequest(BaseModel):
    index_a: int = Field(..., description="Index of the upper paragraph to keep")
    index_b: int = Field(..., description="Index of the lower paragraph to merge into index_a")


class MergeParagraphsResponse(BaseModel):
    document_id: str
    merged_index: int
    message: str


class ReorderParagraphsRequest(BaseModel):
    ordered_indices: list[int] = Field(
        ..., description="New order of paragraph indices, e.g. [3, 1, 0, 2]"
    )


class ReorderParagraphsResponse(BaseModel):
    document_id: str
    message: str
