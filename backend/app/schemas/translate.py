"""Pydantic schemas for paragraph translation."""

from pydantic import BaseModel, Field


class TranslateRequest(BaseModel):
    paragraphs: list[str] = Field(..., min_length=1)
    api_key: str | None = Field(
        default=None, description="DeepSeek API key (uses server default if empty)"
    )
    document_id: str | None = Field(
        default=None, description="If set, save translations to DB for this document"
    )


class TranslateResponse(BaseModel):
    translations: list[str]
