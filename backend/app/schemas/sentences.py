"""Pydantic schemas for sentence structure analysis."""

from pydantic import BaseModel, Field


class SentenceEntry(BaseModel):
    paragraph_index: int = Field(ge=0)
    sentence_index: int = Field(ge=0)
    sentence_text: str
    sentence_translation: str | None = None  # paragraph-level translation for context


class SentenceAnalysisRequest(BaseModel):
    entries: list[SentenceEntry] = Field(min_length=1)
    api_key: str | None = None
    document_id: str


class StructureItem(BaseModel):
    text: str
    label: str  # e.g. "主语从句", "谓语", "定语从句"
    explanation: str  # grammatical explanation of this part


class SentenceAnalysisResult(BaseModel):
    id: str | None = None
    paragraph_index: int
    sentence_index: int
    sentence_text: str
    structure: list[StructureItem] = Field(default_factory=list)
    idiomatic_translation: str = ""


class SentenceAnalysisResponse(BaseModel):
    analyses: list[SentenceAnalysisResult]
