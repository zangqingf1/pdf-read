"""Document model — stores PDF parsing results."""

import uuid
from datetime import datetime

from sqlalchemy import JSON, String, Integer, Text, DateTime, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    title: Mapped[str | None] = mapped_column(String(500))
    source: Mapped[str | None] = mapped_column(String(200))
    original_text: Mapped[str] = mapped_column(Text)
    paragraph_count: Mapped[int | None] = mapped_column(Integer)
    word_count: Mapped[int | None] = mapped_column(Integer)
    file_path: Mapped[str | None] = mapped_column(String(500))
    parse_status: Mapped[str] = mapped_column(
        String(20), default="pending"
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    selected_pages: Mapped[list[int] | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    paragraphs: Mapped[list["Paragraph"]] = relationship(
        "Paragraph", back_populates="document", cascade="all, delete-orphan"
    )
    word_analyses: Mapped[list["WordAnalysis"]] = relationship(
        "WordAnalysis", back_populates="document", cascade="all, delete-orphan"
    )
    sentence_analyses: Mapped[list["SentenceAnalysis"]] = relationship(
        "SentenceAnalysis", back_populates="document", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Document(id={self.id}, title={self.title}, status={self.parse_status})>"
