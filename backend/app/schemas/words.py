"""Pydantic schemas for word analysis API."""

from typing import Literal

from pydantic import BaseModel, Field


class WordEntry(BaseModel):
    """A group of words selected from one paragraph."""

    paragraph_index: int = Field(..., ge=0)
    words: list[str] = Field(..., min_length=1, max_length=20)
    sentence: str = Field(..., description="The source paragraph text for context")
    sentence_translation: str | None = Field(
        default=None, description="Existing Chinese translation of the paragraph"
    )


class WordAnalysisRequest(BaseModel):
    """Request to analyze selected words."""

    entries: list[WordEntry] = Field(..., min_length=1)
    api_key: str | None = Field(default=None)
    document_id: str = Field(..., min_length=1, description="Document ID for persisting results")
    provider: Literal["deepseek"] | None = Field(
        default=None, description="AI provider: deepseek"
    )


class WordAnalysisResult(BaseModel):
    """A single word's complete analysis."""

    id: str | None = Field(default=None, description="DB record ID (null for unsaved)")
    paragraph_index: int
    word: str
    phonetic: str = ""
    part_of_speech: str = ""
    definition: str = ""
    definition_zh: str = ""
    collocations: list[str] = Field(default_factory=list)
    example_sentence: str = ""
    cognates: list[dict] = Field(default_factory=list)
    synonyms_antonyms: dict = Field(default_factory=lambda: {"synonyms": []})
    base_form: str = ""
    plural_form: str = ""
    exam_tags: list[str] = Field(default_factory=list)


class WordAnalysisResponse(BaseModel):
    """Response containing all word analyses."""

    analyses: list[WordAnalysisResult]


class SyllabusMatchRequest(BaseModel):
    """Request to match words against selected exam syllabi (考纲标注)."""

    tags: list[str] = Field(
        ...,
        min_length=1,
        max_length=8,
        description="Exam tag labels, e.g. ['四级', '考研']",
    )
    words: list[str] = Field(
        ...,
        min_length=1,
        max_length=20000,
        description="Deduplicated lowercase surface-form tokens from a document",
    )


class SyllabusMatchResponse(BaseModel):
    """Words (lowercase) whose ECDICT tags intersect the requested syllabi."""

    matched: list[str] = Field(default_factory=list)
