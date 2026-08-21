"""Admin API routes — dashboard, user management, document management."""

import os as _os
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import require_superuser
from app.database import get_db
from app.models.document import Document
from app.models.paragraph import Paragraph
from app.models.sentence_analysis import SentenceAnalysis
from app.models.user import User
from app.models.word_analysis import WordAnalysis
from app.schemas.admin import (
    AdminBatchDeleteRequest,
    AdminBatchDeleteResponse,
    AdminDocumentItem,
    AdminDocumentListResponse,
    AdminQuoteCreateRequest,
    AdminQuoteItem,
    AdminQuoteListResponse,
    AdminQuoteUpdateRequest,
    AdminStats,
    AdminUserItem,
    AdminUserListResponse,
    AdminUserUpdateRequest,
)
from app.models.daily_quote import DailyQuote

router = APIRouter()


# ── Dashboard ──

@router.get("/stats", response_model=AdminStats)
async def get_admin_stats(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_superuser),
):
    """Return aggregate statistics for the admin dashboard."""
    now_func = func.now()

    total_users = (await db.execute(select(func.count(User.id)))).scalar() or 0
    total_documents = (await db.execute(select(func.count(Document.id)))).scalar() or 0

    today_users = (
        await db.execute(
            select(func.count(User.id)).where(
                func.date(User.created_at) == func.date(now_func)
            )
        )
    ).scalar() or 0

    today_documents = (
        await db.execute(
            select(func.count(Document.id)).where(
                func.date(Document.created_at) == func.date(now_func)
            )
        )
    ).scalar() or 0

    return AdminStats(
        total_users=total_users,
        total_documents=total_documents,
        today_users=today_users,
        today_documents=today_documents,
    )


# ── User Management ──

@router.get("/users", response_model=AdminUserListResponse)
async def list_users(
    search: str = Query("", description="Search email or nickname"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_superuser),
):
    """List all users with optional search and pagination."""
    # Base query
    base_q = select(User)
    count_q = select(func.count(User.id))

    if search:
        pattern = f"%{search}%"
        filter_clause = User.email.ilike(pattern) | User.nickname.ilike(pattern)
        base_q = base_q.where(filter_clause)
        count_q = count_q.where(filter_clause)

    total = (await db.execute(count_q)).scalar() or 0

    users = (
        await db.execute(
            base_q.order_by(User.created_at.desc()).offset(offset).limit(limit)
        )
    ).scalars().all()

    # Batch-fetch document counts with a single query (avoid N+1)
    user_ids = [u.id for u in users]
    doc_counts: dict[uuid.UUID, int] = {}
    if user_ids:
        counts_q = (
            select(Document.user_id, func.count(Document.id).label("cnt"))
            .where(Document.user_id.in_(user_ids))
            .group_by(Document.user_id)
        )
        rows = (await db.execute(counts_q)).all()
        doc_counts = {row.user_id: row.cnt for row in rows}

    user_items: list[AdminUserItem] = [
        AdminUserItem.from_user(u, doc_counts.get(u.id, 0))
        for u in users
    ]

    return AdminUserListResponse(users=user_items, total=total)


@router.put("/users/{user_id}")
async def update_user(
    user_id: str,
    body: AdminUserUpdateRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_superuser),
):
    """Update a user's is_active / is_superuser flags.

    Prevents self-demotion (cannot remove your own superuser flag).
    """
    if body.is_active is None and body.is_superuser is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one of is_active or is_superuser must be provided.",
        )

    try:
        target_uuid = uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="User not found.")

    # Fetch target user
    target = (
        await db.execute(select(User).where(User.id == target_uuid))
    ).scalar_one_or_none()
    if target is None:
        raise HTTPException(status_code=404, detail="User not found.")

    # Prevent self-demotion / self-lockout (an admin must not remove the
    # last usable admin account by disabling their own account).
    if target.id == admin.id and (
        body.is_superuser is False or body.is_active is False
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot remove your own admin privileges or disable your own account.",
        )

    # Build update values
    values = {}
    if body.is_active is not None:
        values["is_active"] = body.is_active
    if body.is_superuser is not None:
        values["is_superuser"] = body.is_superuser

    await db.execute(update(User).where(User.id == target_uuid).values(**values))
    await db.commit()

    return {"detail": "User updated successfully"}


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_superuser),
):
    """Delete a user and all their associated data.

    Prevents self-deletion.
    """
    try:
        target_uuid = uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="User not found.")

    # Prevent self-deletion
    if target_uuid == admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot delete your own account.",
        )

    # Fetch target user with documents (to clean up files)
    target = (
        await db.execute(
            select(User).where(User.id == target_uuid).options(selectinload(User.documents))
        )
    ).scalar_one_or_none()
    if target is None:
        raise HTTPException(status_code=404, detail="User not found.")

    # Remove PDF files from disk
    for doc in target.documents:
        if doc.file_path and _os.path.exists(doc.file_path):
            try:
                _os.remove(doc.file_path)
            except OSError:
                pass

    # Delete user (cascade deletes documents, paragraphs, analyses)
    await db.delete(target)
    await db.commit()

    return {"detail": "User deleted successfully"}


# ── Document Management ──

@router.get("/documents", response_model=AdminDocumentListResponse)
async def list_all_documents(
    search: str = Query("", description="Search document title"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_superuser),
):
    """List all documents across all users with optional search and pagination."""
    base_q = select(Document).options(selectinload(Document.owner))
    count_q = select(func.count(Document.id))

    if search:
        pattern = f"%{search}%"
        filter_clause = Document.title.ilike(pattern)
        base_q = base_q.where(filter_clause)
        count_q = count_q.where(filter_clause)

    total = (await db.execute(count_q)).scalar() or 0

    docs = (
        await db.execute(
            base_q.order_by(Document.created_at.desc()).offset(offset).limit(limit)
        )
    ).scalars().all()

    items = [
        AdminDocumentItem.from_document(
            doc,
            owner_email=doc.owner.email if doc.owner else "(deleted)",
            owner_nickname=doc.owner.nickname if doc.owner else None,
        )
        for doc in docs
    ]

    return AdminDocumentListResponse(documents=items, total=total)


@router.post("/documents/batch-delete", response_model=AdminBatchDeleteResponse)
async def batch_delete_documents(
    body: AdminBatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_superuser),
):
    """Delete multiple documents at once (admin — across all users).

    Deletes any document regardless of owner. Invalid IDs and
    already-deleted documents are silently skipped.

    Args:
        body: {document_ids: [...]} — max 100 IDs per request.
    """
    deleted_count = 0
    failed_ids: list[str] = []

    # 先统一解析 ID：非法 UUID 直接进 failed_ids
    valid_uuids: list[uuid.UUID] = []
    for doc_id_str in body.document_ids:
        try:
            valid_uuids.append(uuid.UUID(doc_id_str))
        except ValueError:
            failed_ids.append(doc_id_str)
            continue

    if valid_uuids:
        # 单条 IN 查询：一次取出全部目标（跨所有用户），顺带取 file_path
        rows = (
            await db.execute(
                select(Document.id, Document.file_path).where(
                    Document.id.in_(valid_uuids)
                )
            )
        ).all()
        found_ids = [row.id for row in rows]
        # 与旧行为一致：合法但已不存在的 ID 计入 failed_ids
        found_set = set(found_ids)
        for doc_uuid in valid_uuids:
            if doc_uuid not in found_set:
                failed_ids.append(str(doc_uuid))

        # Remove PDF files from disk (best-effort)
        for row in rows:
            if row.file_path and _os.path.exists(row.file_path):
                try:
                    _os.remove(row.file_path)
                except OSError:
                    pass

        if found_ids:
            # bulk DELETE 不触发 ORM cascade：显式先删子表再删文档，
            # SQLite/PostgreSQL 行为一致，全部在一个事务内完成。
            # 注意类型：paragraphs.document_id 是 Uuid 列（传 UUID 对象），
            # word/sentence_analyses.document_id 是 String(36) 列（传字符串）。
            str_ids = [str(i) for i in found_ids]
            await db.execute(
                delete(Paragraph).where(Paragraph.document_id.in_(found_ids))
            )
            await db.execute(
                delete(WordAnalysis).where(WordAnalysis.document_id.in_(str_ids))
            )
            await db.execute(
                delete(SentenceAnalysis).where(SentenceAnalysis.document_id.in_(str_ids))
            )
            result = await db.execute(
                delete(Document).where(Document.id.in_(found_ids))
            )
            deleted_count = result.rowcount if result.rowcount is not None else len(found_ids)

    await db.commit()

    return AdminBatchDeleteResponse(
        deleted_count=deleted_count,
        failed_ids=failed_ids,
        message=f"成功删除 {deleted_count} 个文档"
        + (f"，{len(failed_ids)} 个失败" if failed_ids else ""),
    )


@router.delete("/documents/{doc_id}")
async def delete_any_document(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_superuser),
):
    """Delete any document and its PDF file from disk (admin override)."""
    try:
        doc_uuid = uuid.UUID(doc_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Document not found.")

    doc = (
        await db.execute(
            select(Document).where(Document.id == doc_uuid)
        )
    ).scalar_one_or_none()
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found.")

    # Remove PDF file from disk
    if doc.file_path and _os.path.exists(doc.file_path):
        try:
            _os.remove(doc.file_path)
        except OSError:
            pass

    await db.delete(doc)
    await db.commit()

    return {"detail": "Document deleted successfully"}


# ── Daily Quote Management ──

@router.get("/quotes", response_model=AdminQuoteListResponse)
async def list_quotes(
    search: str = Query("", description="Search English text or author"),
    active: bool | None = Query(None, description="Filter by active status"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_superuser),
):
    """List daily quotes with optional search, status filter and pagination."""
    base_q = select(DailyQuote)
    count_q = select(func.count(DailyQuote.id))

    if search:
        pattern = f"%{search}%"
        filter_clause = DailyQuote.text_en.ilike(pattern) | DailyQuote.author.ilike(pattern)
        base_q = base_q.where(filter_clause)
        count_q = count_q.where(filter_clause)

    if active is not None:
        base_q = base_q.where(DailyQuote.active.is_(active))
        count_q = count_q.where(DailyQuote.active.is_(active))

    total = (await db.execute(count_q)).scalar() or 0

    quotes = (
        await db.execute(
            base_q.order_by(DailyQuote.id.desc()).offset(offset).limit(limit)
        )
    ).scalars().all()

    return AdminQuoteListResponse(
        quotes=[AdminQuoteItem.from_quote(q) for q in quotes],
        total=total,
    )


@router.post("/quotes", response_model=AdminQuoteItem, status_code=status.HTTP_201_CREATED)
async def create_quote(
    body: AdminQuoteCreateRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_superuser),
):
    """Create a new daily quote."""
    quote = DailyQuote(
        text_en=body.text_en,
        text_zh=body.text_zh,
        author=body.author,
        active=body.active,
    )
    db.add(quote)
    await db.commit()
    await db.refresh(quote)
    return AdminQuoteItem.from_quote(quote)


@router.put("/quotes/{quote_id}", response_model=AdminQuoteItem)
async def update_quote(
    quote_id: int,
    body: AdminQuoteUpdateRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_superuser),
):
    """Update a daily quote (partial update allowed)."""
    quote = await db.get(DailyQuote, quote_id)
    if quote is None:
        raise HTTPException(status_code=404, detail="Quote not found.")

    if body.text_en is not None:
        quote.text_en = body.text_en
    if body.text_zh is not None:
        quote.text_zh = body.text_zh
    if body.author is not None:
        quote.author = body.author
    if body.active is not None:
        quote.active = body.active

    await db.commit()
    await db.refresh(quote)
    return AdminQuoteItem.from_quote(quote)


@router.delete("/quotes/{quote_id}")
async def delete_quote(
    quote_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_superuser),
):
    """Delete a daily quote."""
    quote = await db.get(DailyQuote, quote_id)
    if quote is None:
        raise HTTPException(status_code=404, detail="Quote not found.")

    await db.delete(quote)
    await db.commit()
    return {"detail": "Quote deleted successfully"}
