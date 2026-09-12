"""Feedback model — 用户问题反馈（含可选截图与管理员回复）。"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# category: "bug" 功能异常 / "feature" 体验建议 / "content" 内容问题 / "other" 其他
# status:   "pending" 待处理 / "processing" 处理中 / "resolved" 已解决 / "ignored" 已忽略


class Feedback(Base):
    __tablename__ = "feedbacks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    contact: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # 截图相对路径列表的 JSON 数组（最多 FEEDBACK_MAX_IMAGES 张），
    # 如 ["feedback/<user_id>-<hex>.png", ...]；仅本服务自己生成
    # （不接收客户端路径）。旧库的 image_path 单列由迁移 019b 回填进来。
    image_paths: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending", server_default="pending"
    )
    admin_reply: Mapped[str | None] = mapped_column(Text, nullable=True)
    replied_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    def __repr__(self) -> str:
        return f"<Feedback(id={self.id}, status={self.status})>"


# 「我的反馈」按用户倒序取最新，后台按状态筛选后倒序
Index("ix_feedbacks_user_id", Feedback.user_id, Feedback.id)
Index("ix_feedbacks_status", Feedback.status, Feedback.id)
