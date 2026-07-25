"""Pydantic schemas for sentence analysis (精讲)."""

from typing import Literal

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
    provider: Literal["deepseek"] | None = Field(
        default=None, description="AI provider: deepseek"
    )


class SentenceAnalysisResult(BaseModel):
    id: str | None = None
    paragraph_index: int
    sentence_index: int
    sentence_text: str
    content: str = ""  # Raw markdown from AI: 原文/主干/讲解/译文


class SentenceAnalysisResponse(BaseModel):
    analyses: list[SentenceAnalysisResult]
