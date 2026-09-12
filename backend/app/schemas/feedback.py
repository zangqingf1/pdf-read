"""Feedback schemas — 用户问题反馈（用户侧 + 管理后台）。

用户提交走 multipart（可选截图文件），因此创建请求不用 pydantic body，
只有 ``CATEGORY_VALUES`` 字面量供路由做 Form 参数校验；其余为响应模型。
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.services.feedback_service import decode_image_paths

CATEGORY_VALUES = ("bug", "feature", "content", "other")
STATUS_VALUES = ("pending", "processing", "resolved", "ignored")

FeedbackCategory = Literal["bug", "feature", "content", "other"]
FeedbackStatus = Literal["pending", "processing", "resolved", "ignored"]


def image_count_of(raw: str | None) -> int:
    """Count stored screenshot paths (JSON array text; tolerant of bad data)."""
    return len(decode_image_paths(raw))


class FeedbackItem(BaseModel):
    """用户自己看到的一条反馈（含管理员回复）。"""

    id: int
    category: str
    content: str
    contact: str | None = None
    image_count: int = 0
    status: str
    admin_reply: str | None = None
    replied_at: datetime | None = None
    created_at: datetime

    @classmethod
    def from_feedback(cls, fb) -> "FeedbackItem":
        return cls(
            id=fb.id,
            category=fb.category,
            content=fb.content,
            contact=fb.contact,
            image_count=image_count_of(fb.image_paths),
            status=fb.status,
            admin_reply=fb.admin_reply,
            replied_at=fb.replied_at,
            created_at=fb.created_at,
        )


class FeedbackListResponse(BaseModel):
    """Paginated own-feedback list."""

    feedbacks: list[FeedbackItem]
    total: int


class AdminFeedbackItem(BaseModel):
    """A single feedback row in the admin list (carries submitter info)."""

    id: int
    user_id: str
    user_email: str
    user_nickname: str | None = None
    category: str
    content: str
    contact: str | None = None
    image_count: int = 0
    status: str
    admin_reply: str | None = None
    replied_at: datetime | None = None
    created_at: datetime

    @classmethod
    def from_feedback(cls, fb, user=None) -> "AdminFeedbackItem":
        return cls(
            id=fb.id,
            user_id=str(fb.user_id),
            user_email=(user.email if user is not None else ""),
            user_nickname=(user.nickname if user is not None else None),
            category=fb.category,
            content=fb.content,
            contact=fb.contact,
            image_count=image_count_of(fb.image_paths),
            status=fb.status,
            admin_reply=fb.admin_reply,
            replied_at=fb.replied_at,
            created_at=fb.created_at,
        )


class AdminFeedbackListResponse(BaseModel):
    """Paginated feedback list (all users)."""

    feedbacks: list[AdminFeedbackItem]
    total: int


class AdminFeedbackUpdateRequest(BaseModel):
    """Fields the admin may update on a feedback row."""

    status: FeedbackStatus | None = None
    admin_reply: str | None = Field(None, max_length=2000)
