"""Pydantic schemas for prompt template management."""

from datetime import datetime

from pydantic import BaseModel, Field


class PromptTemplateOut(BaseModel):
    """Single prompt template returned to the frontend."""

    name: str = Field(..., description="Template type: translate | analyze_words | analyze_sentences")
    display_name: str = Field(default="", description="Human-readable name in Chinese")
    system_prompt: str = Field(default="", description="Optional system message")
    user_prompt: str = Field(..., description="Main instruction with {placeholders}")
    placeholders: list[str] = Field(default_factory=list, description="Available placeholder variables")
    is_customized: bool = Field(default=False, description="Whether user has saved a custom version")
    updated_at: datetime | None = Field(default=None, description="Last update time")

    model_config = {"from_attributes": True}


class PromptTemplateListResponse(BaseModel):
    """Response for listing all prompt templates."""

    templates: list[PromptTemplateOut]


class PromptTemplateUpdateRequest(BaseModel):
    """Request body for updating a prompt template."""

    system_prompt: str = Field(
        default="",
        max_length=5000,
        description="Optional system message (role/persona)",
    )
    user_prompt: str = Field(
        ...,
        min_length=1,
        max_length=10000,
        description="Main instruction with {placeholders}",
    )
