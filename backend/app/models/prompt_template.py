"""Prompt template model — stores user-customized AI prompt overrides."""

from datetime import datetime

from sqlalchemy import String, Text, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class PromptTemplate(Base):
    """Stores custom prompt templates keyed by name.

    When a row exists with non-empty prompts, it overrides the built-in
    defaults from prompt_defaults.py.  Deleting the row resets to defaults.
    """

    __tablename__ = "prompt_templates"

    name: Mapped[str] = mapped_column(
        String(50), primary_key=True,
        comment="Template type: translate | analyze_words | analyze_sentences",
    )
    system_prompt: Mapped[str] = mapped_column(
        Text, default="",
        comment="Optional system message (role/persona). Sent as system role when non-empty.",
    )
    user_prompt: Mapped[str] = mapped_column(
        Text, default="",
        comment="Main instruction with {placeholders}. Always sent as user role.",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(),
    )
