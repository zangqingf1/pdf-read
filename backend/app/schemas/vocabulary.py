"""Vocabulary book schemas."""

from datetime import datetime

from pydantic import BaseModel, Field


class VocabularySourceOut(BaseModel):
    document_id: str
    document_title: str | None = None
    added_at: datetime | None = None
    paragraph_index: int | None = None
    token_rank: int | None = None


class VocabularyEntryOut(BaseModel):
    id: str
    word: str
    word_original: str
    phonetic: str = ""
    pos: str = ""
    translation: str = ""
    definition_en: str = ""
    source_document_id: str | None = None
    source_document_title: str | None = None
    latest_paragraph_index: int | None = None
    latest_token_rank: int | None = None
    all_sources: list[VocabularySourceOut] = Field(default_factory=list)
    context_sentence: str | None = None
    definition_zh: str = ""
    base_form: str = ""
    plural_form: str = ""
    synonyms_antonyms: str = '{"synonyms": []}'
    cognates: str = "[]"
    collocations: str = "[]"
    exam_tags: str = "[]"
    # SRS scheduling state (simplified SM-2; see services/srs_service.py)
    srs_due_at: datetime | None = None
    srs_interval_days: float = 0.0
    srs_ease: float = 2.5
    srs_reps: int = 0
    srs_lapses: int = 0
    srs_status: str = "active"
    created_at: datetime | None = None
    updated_at: datetime | None = None


class VocabularyBatchAddRequest(BaseModel):
    document_id: str = Field(..., min_length=1)
    words: list[str] | None = Field(default=None, description="Optional subset; if empty, all analyzed words of the document are added")


class VocabularyBatchAddResponse(BaseModel):
    added: int
    skipped: int
    total: int
    items: list[VocabularyEntryOut] = Field(default_factory=list)


class VocabularyListResponse(BaseModel):
    items: list[VocabularyEntryOut]
    total: int
    page: int
    page_size: int
    sort_by: str
    order: str
    """按添加日期（本地时区 YYYY-MM-DD）统计的全量条数，用于前端日期分组标题。"""
    day_counts: dict[str, int] = Field(default_factory=dict)


class VocabularyBatchDeleteRequest(BaseModel):
    ids: list[str] = Field(..., min_length=1)


class VocabularyBatchDeleteResponse(BaseModel):
    deleted: int
