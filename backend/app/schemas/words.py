"""Pydantic schemas for word analysis API."""

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
    document_id: str = Field(..., description="Document ID for persisting results")


class WordAnalysisResult(BaseModel):
    """A single word's complete analysis."""

    id: str | None = Field(default=None, description="DB record ID (null for unsaved)")
    paragraph_index: int
    word: str
    phonetic: str = ""
    part_of_speech: str = ""
    definition: str = ""
    definition_zh: str = ""
    example_sentences: list[str] = Field(default_factory=list)
    example_sentences_zh: list[str] = Field(default_factory=list)


class WordAnalysisResponse(BaseModel):
    """Response containing all word analyses."""

    analyses: list[WordAnalysisResult]
