"""Pydantic schemas for paragraph translation."""

from typing import Literal

from pydantic import BaseModel, Field


class TranslateRequest(BaseModel):
    # 未设上限时单个请求可携带任意数量段落（整篇文档一次性发送）；2000 段远超实际文档
    paragraphs: list[str] = Field(..., min_length=0, max_length=2000)
    title: str | None = Field(
        default=None,
        description="大标题原文，随段落一并翻译并持久化到 documents.title_zh "
        "(不占用 paragraphs 索引)",
    )
    api_key: str | None = Field(
        default=None, description="AI API key (required — set via frontend 🔑 icon)"
    )
    document_id: str | None = Field(
        default=None, description="If set, save translations to DB for this document"
    )
    indices: list[int] | None = Field(
        default=None,
        max_length=2000,
        description="Real paragraph indices, positionally aligned with `paragraphs`. "
        "When omitted, positions are treated as indices (legacy behavior).",
    )
    provider: Literal["deepseek"] | None = Field(
        default=None, description="AI provider: deepseek"
    )


class TranslateResponse(BaseModel):
    translations: list[str]
    title_translation: str | None = Field(
        default=None, description="大标题中文翻译（请求带 title 时返回）"
    )
