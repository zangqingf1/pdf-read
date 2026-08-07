"""Sentence analysis model — persisted AI-powered sentence structure analysis per document."""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import UniqueConstraint, ForeignKey, Text, Integer, String, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.database import Base

if TYPE_CHECKING:
    from app.models.document import Document


class SentenceAnalysis(Base):
    __tablename__ = "sentence_analyses"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    document_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    paragraph_index: Mapped[int] = mapped_column(Integer, nullable=False)
    sentence_index: Mapped[int] = mapped_column(Integer, nullable=False)
    sentence_text: Mapped[str] = mapped_column(Text, default="")

    # Full analysis result stored as JSON string:
    # {"structure": [...], "grammar_points": [...], "key_phrases": [...], "idiomatic_translation": "..."}
    structure_json: Mapped[str] = mapped_column(Text, default="{}")

    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now()
    )

    document: Mapped["Document"] = relationship("Document", back_populates="sentence_analyses")

    __table_args__ = (
        UniqueConstraint(
            "document_id", "paragraph_index", "sentence_index",
            name="uq_sentence_analysis_doc_para_sent",
        ),
    )
