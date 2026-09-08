"""Q&A chat message model — persisted AI conversation per document."""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Text, Integer, String, DateTime, Index, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.database import Base

if TYPE_CHECKING:
    from app.models.document import Document


class QaMessage(Base):
    __tablename__ = "qa_messages"

    # 自增整数主键 — 对话历史必须按插入顺序回放，UUID 无单调性
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    document_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)  # "user" / "assistant"
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # Which prompt template drove the assistant turn ("doc_qa" / "doc_quiz");
    # None for user rows.
    prompt_name: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # Paragraph index of the quoted sentence the question was asked about.
    paragraph_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    document: Mapped["Document"] = relationship(back_populates="qa_messages")


Index("ix_qa_messages_document_id", QaMessage.document_id, QaMessage.id)
