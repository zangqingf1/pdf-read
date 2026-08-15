"""Prompt template model — stores admin-defined system defaults and user overrides.

Resolution order (checked at AI-call time):
1. Custom override  (is_default=False) — "用户自定义"
2. System default   (is_default=True)  — "管理员设定的默认"
3. Factory default  (prompt_defaults.py) — hardcoded fallback
"""

from datetime import datetime

from sqlalchemy import Boolean, String, Text, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class PromptTemplate(Base):
    """Stores prompt templates with a two-tier system.

    Each template *name* can have up to two rows:
    - is_default=True  → admin-defined system default
    - is_default=False → legacy/admin custom override (write restricted to superuser)

    The ``_get_prompt_overrides`` lookup picks the most specific row first.
    """

    __tablename__ = "prompt_templates"

    name: Mapped[str] = mapped_column(
        String(50), primary_key=True,
        comment="Template type: translate | analyze_words | analyze_sentences",
    )
    is_default: Mapped[bool] = mapped_column(
        Boolean, primary_key=True, default=False,
        comment="True = system default set by admin; False = user custom override",
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
