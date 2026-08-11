"""Pydantic schemas for paragraph translation."""

from typing import Literal

from pydantic import BaseModel, Field


class TranslateRequest(BaseModel):
    paragraphs: list[str] = Field(..., min_length=1)
    api_key: str | None = Field(
        default=None, description="AI API key (required — set via frontend 🔑 icon)"
    )
    document_id: str | None = Field(
        default=None, description="If set, save translations to DB for this document"
    )
    indices: list[int] | None = Field(
        default=None,
        description="Real paragraph indices, positionally aligned with `paragraphs`. "
        "When omitted, positions are treated as indices (legacy behavior).",
    )
    provider: Literal["deepseek"] | None = Field(
        default=None, description="AI provider: deepseek"
    )


class TranslateResponse(BaseModel):
    translations: list[str]
