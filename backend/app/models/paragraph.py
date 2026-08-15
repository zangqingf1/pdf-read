"""Paragraph model — stores individual paragraphs with translations."""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Integer, Text, DateTime, ForeignKey, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.document import Document


class Paragraph(Base):
    __tablename__ = "paragraphs"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    document_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    index: Mapped[int] = mapped_column(Integer, nullable=False)
    text_en: Mapped[str] = mapped_column(Text, nullable=False)
    text_zh: Mapped[str | None] = mapped_column(Text)
    summary: Mapped[str | None] = mapped_column(Text)
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # MinerU 布局坐标（PDF 源）：JSON {"box":[x1,y1,x2,y2], "pts_w":.., "pts_h":..}
    # box 为 MinerU 渲染图像像素坐标；pts_w/pts_h 为该页 PDF 点数尺寸（pypdf mediabox）
    bbox_json: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now()
    )

    # Relationships
    document: Mapped["Document"] = relationship("Document", back_populates="paragraphs")

    __table_args__ = (
        UniqueConstraint("document_id", "index", name="uq_paragraph_doc_index"),
    )

    def __repr__(self) -> str:
        return f"<Paragraph(doc={self.document_id}, idx={self.index})>"
