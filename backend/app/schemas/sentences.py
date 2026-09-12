"""Pydantic schemas for sentence analysis (精讲)."""

from typing import Literal

from pydantic import BaseModel, Field


class SentenceEntry(BaseModel):
    paragraph_index: int = Field(ge=0)
    sentence_index: int = Field(ge=0)
    sentence_text: str
    sentence_translation: str | None = None  # paragraph-level translation for context


class SentenceAnalysisRequest(BaseModel):
    # 无上限时单个请求可携带整篇文档的句子，拖垮 worker；前端不分片，2000 足够
    entries: list[SentenceEntry] = Field(min_length=1, max_length=2000)
    api_key: str | None = None
    document_id: str = Field(..., min_length=1, description="Document ID for persisting results")
    provider: Literal["deepseek"] | None = Field(
        default=None, description="AI provider: deepseek"
    )


class SentenceAnalysisResult(BaseModel):
    id: str | None = None
    paragraph_index: int
    sentence_index: int
    sentence_text: str
    content: str = ""  # Raw markdown from AI: 原句拆解/理解拆解/阅读线索/地道翻译


class SentenceAnalysisResponse(BaseModel):
    analyses: list[SentenceAnalysisResult]
