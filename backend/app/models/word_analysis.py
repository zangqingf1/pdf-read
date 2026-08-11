"""Word analysis model — persisted AI-powered word lookups per document."""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import UniqueConstraint, ForeignKey, Text, Integer, String, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.database import Base

if TYPE_CHECKING:
    from app.models.document import Document


class WordAnalysis(Base):
    __tablename__ = "word_analyses"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    document_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    paragraph_index: Mapped[int] = mapped_column(Integer, nullable=False)
    word: Mapped[str] = mapped_column(String(200), nullable=False)

    phonetic: Mapped[str] = mapped_column(String(200), default="")
    original_sentence: Mapped[str] = mapped_column(Text, default="")
    original_sentence_zh: Mapped[str] = mapped_column(Text, default="")
    part_of_speech: Mapped[str] = mapped_column(String(50), default="")
    definition: Mapped[str] = mapped_column(Text, default="")
    definition_zh: Mapped[str] = mapped_column(Text, default="")
    collocations: Mapped[str] = mapped_column(Text, default="[]")
    example_sentence: Mapped[str] = mapped_column(Text, default="")
    cognates: Mapped[str] = mapped_column(Text, default="[]")
    synonyms_antonyms: Mapped[str] = mapped_column(Text, default='{"synonyms": []}')
    base_form: Mapped[str] = mapped_column(Text, default="")
    plural_form: Mapped[str] = mapped_column(Text, default="")

    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now()
    )

    document: Mapped["Document"] = relationship("Document", back_populates="word_analyses")

    __table_args__ = (
        UniqueConstraint(
            "document_id", "paragraph_index", "word",
            name="uq_word_analysis_doc_para_word",
        ),
    )
