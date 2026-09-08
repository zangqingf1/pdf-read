"""Vocabulary book model — user-scoped word collection with dictionary definitions."""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    ForeignKey,
    Float,
    Index,
    Integer,
    String,
    Text,
    Uuid,
    UniqueConstraint,
    DateTime,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.document import Document
    from app.models.vocabulary_source import VocabularySource


class VocabularyEntry(Base):
    __tablename__ = "vocabulary_entries"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # lowercased for dedup, original case preserved for display
    word: Mapped[str] = mapped_column(String(200), nullable=False)
    word_original: Mapped[str] = mapped_column(String(200), nullable=False)
    phonetic: Mapped[str] = mapped_column(String(200), default="")
    pos: Mapped[str] = mapped_column(String(50), default="")
    translation: Mapped[str] = mapped_column(Text, default="")
    definition_en: Mapped[str] = mapped_column(Text, default="")
    source_document_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("documents.id", ondelete="SET NULL"), nullable=True
    )
    context_sentence: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Rich analysis fields carried from WordAnalysis when added (mirrors
    # word_analyses JSON-string storage so the word book card matches the
    # reader study panel). Empty/blank means "not available".
    definition_zh: Mapped[str] = mapped_column(Text, default="")
    base_form: Mapped[str] = mapped_column(Text, default="")
    plural_form: Mapped[str] = mapped_column(Text, default="")
    synonyms_antonyms: Mapped[str] = mapped_column(Text, default='{"synonyms": []}')
    cognates: Mapped[str] = mapped_column(Text, default="[]")
    collocations: Mapped[str] = mapped_column(Text, default="[]")
    # JSON array of exam-syllabus tags, looked up directly from local ECDICT
    # at batch-add time (WordAnalysis-carried values only as fallback).
    exam_tags: Mapped[str] = mapped_column(Text, default="[]")
    # Document-order sorting anchor — first occurrence in latest document
    latest_paragraph_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    latest_token_rank: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Spaced-repetition scheduling (simplified SM-2, see services/srs_service.py).
    # Every entry is a review card; srs_due_at NULL means "new card, due now".
    srs_due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    srs_interval_days: Mapped[float] = mapped_column(Float, default=0.0)
    srs_ease: Mapped[float] = mapped_column(Float, default=2.5)
    srs_reps: Mapped[int] = mapped_column(Integer, default=0)
    srs_lapses: Mapped[int] = mapped_column(Integer, default=0)
    # 'active' (in queue) | 'mastered' (removed from queue)
    srs_status: Mapped[str] = mapped_column(String(16), default="active")
    srs_last_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    owner: Mapped["User"] = relationship("User", back_populates="vocabulary_entries")
    source_document: Mapped["Document | None"] = relationship("Document")
    sources: Mapped[list["VocabularySource"]] = relationship(
        "VocabularySource", back_populates="entry", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("user_id", "word", name="uq_vocab_user_word"),
        Index("idx_vocab_user_created", "user_id", "created_at"),
        Index("idx_vocab_user_pos", "user_id", "pos"),
        Index("idx_vocab_user_doc_order", "user_id", "latest_paragraph_index", "latest_token_rank"),
        Index("idx_vocab_user_srs", "user_id", "srs_status", "srs_due_at"),
    )

    def __repr__(self) -> str:
        return f"<VocabularyEntry(user={self.user_id}, word={self.word})>"
