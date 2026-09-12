"""用户问题反馈端点 — 提交（可选截图）、查看自己的历史与管理员回复、取截图。"""

import logging

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import feedback_rate_limit
from app.auth.deps import get_current_user
from app.database import get_db
from app.models.feedback import Feedback
from app.models.user import User
from app.schemas.feedback import (
    CATEGORY_VALUES,
    FeedbackItem,
    FeedbackListResponse,
)
from app.services import feedback_service

logger = logging.getLogger(__name__)

router = APIRouter()

CONTENT_MAX_LENGTH = 2000
CONTACT_MAX_LENGTH = 200


@router.post("", response_model=FeedbackItem, status_code=status.HTTP_201_CREATED)
async def create_feedback(
    category: str = Form(...),
    content: str = Form(..., min_length=1, max_length=CONTENT_MAX_LENGTH),
    contact: str | None = Form(None, max_length=CONTACT_MAX_LENGTH),
    images: list[UploadFile] | None = File(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _rate_limit: None = Depends(feedback_rate_limit),
):
    """提交问题反馈（multipart，截图可选，最多 FEEDBACK_MAX_IMAGES 张）。"""
    if category not in CATEGORY_VALUES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="反馈分类无效。",
        )
    text = (content or "").strip()
    if not text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="反馈内容不能为空。",
        )

    # 空文件框（未选择任何文件）会被浏览器以空 filename 提交，需剔除
    files = [f for f in (images or []) if (f.filename or "").strip()]

    image_paths: list[str] = []
    if files:
        image_paths = await feedback_service.save_feedback_images(
            files, str(current_user.id)
        )

    fb = Feedback(
        user_id=current_user.id,
        category=category,
        content=text,
        contact=((contact or "").strip() or None),
        image_paths=feedback_service.encode_image_paths(image_paths),
    )
    db.add(fb)
    try:
        await db.flush()
    except Exception:
        # 落库失败时清掉刚写下的截图，避免留下孤儿文件
        feedback_service.delete_feedback_images(image_paths)
        raise
    await db.commit()
    await db.refresh(fb)
    return FeedbackItem.from_feedback(fb)


@router.get("/mine", response_model=FeedbackListResponse)
async def list_my_feedback(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """当前用户的反馈列表（最新在前）。"""
    total = (
        await db.execute(
            select(func.count(Feedback.id)).where(Feedback.user_id == current_user.id)
        )
    ).scalar() or 0
    rows = (
        (
            await db.execute(
                select(Feedback)
                .where(Feedback.user_id == current_user.id)
                .order_by(Feedback.id.desc())
                .offset(offset)
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return FeedbackListResponse(
        feedbacks=[FeedbackItem.from_feedback(fb) for fb in rows],
        total=total,
    )


@router.get("/{feedback_id}/images/{index}")
async def get_feedback_image(
    feedback_id: int,
    index: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """反馈截图（按 0 基索引取，仅提交者本人或管理员）。"""
    fb = (
        await db.execute(select(Feedback).where(Feedback.id == feedback_id))
    ).scalar_one_or_none()
    if fb is None or (
        fb.user_id != current_user.id and not current_user.is_superuser
    ):
        # 不区分「不存在」与「无权限」，避免泄露他人反馈的存在性
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="截图不存在。",
        )
    paths = feedback_service.decode_image_paths(fb.image_paths)
    if index < 0 or index >= len(paths):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="截图不存在。",
        )
    path = feedback_service.resolve_feedback_image_path(paths[index])
    if path is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="截图不存在。",
        )
    return FileResponse(path, media_type=feedback_service.media_type_for(str(path)))
