"""DailyQuote model — 每日一句名句库（管理后台可编辑）。"""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class DailyQuote(Base):
    __tablename__ = "daily_quotes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    text_en: Mapped[str] = mapped_column(String(2000), nullable=False)
    text_zh: Mapped[str] = mapped_column(String(2000), nullable=False)
    author: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("1")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now()
    )

    def __repr__(self) -> str:
        return f"<DailyQuote(id={self.id}, author={self.author})>"
