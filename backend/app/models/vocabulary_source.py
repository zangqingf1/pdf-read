"""Vocabulary source — tracks all documents where a word was seen."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, DateTime, Integer, Text, func, UniqueConstraint, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.vocabulary import VocabularyEntry


class VocabularySource(Base):
    __tablename__ = "vocabulary_sources"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    vocabulary_entry_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("vocabulary_entries.id", ondelete="CASCADE"), nullable=False, index=True
    )
    document_id: Mapped[str] = mapped_column(String(36), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    document_title: Mapped[str | None] = mapped_column(Text, nullable=True)
    paragraph_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    token_rank: Mapped[int | None] = mapped_column(Integer, nullable=True)
    added_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    entry: Mapped["VocabularyEntry"] = relationship("VocabularyEntry", back_populates="sources")

    __table_args__ = (
        UniqueConstraint("vocabulary_entry_id", "document_id", name="uq_vocab_source_entry_doc"),
        Index("idx_vocab_source_entry", "vocabulary_entry_id"),
        Index("idx_vocab_source_doc", "document_id"),
    )
