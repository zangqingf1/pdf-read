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
from app.models.user import User
from app.schemas.admin import (
    AdminBatchDeleteRequest,
    AdminBatchDeleteResponse,
    AdminDocumentItem,
    AdminDocumentListResponse,
    AdminStats,
    AdminUserItem,
    AdminUserListResponse,
    AdminUserUpdateRequest,
)

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

    # Batch-fetch document counts for each user
    user_items: list[AdminUserItem] = []
    for user in users:
        doc_count = (
            await db.execute(
                select(func.count(Document.id)).where(Document.user_id == user.id)
            )
        ).scalar() or 0
        user_items.append(AdminUserItem.from_user(user, doc_count))

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

    target_uuid = uuid.UUID(user_id)

    # Fetch target user
    target = (
        await db.execute(select(User).where(User.id == target_uuid))
    ).scalar_one_or_none()
    if target is None:
        raise HTTPException(status_code=404, detail="User not found.")

    # Prevent self-demotion
    if target.id == admin.id and body.is_superuser is False:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot remove your own admin privileges.",
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
    target_uuid = uuid.UUID(user_id)

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

    for doc_id_str in body.document_ids:
        try:
            doc_uuid = uuid.UUID(doc_id_str)
        except ValueError:
            failed_ids.append(doc_id_str)
            continue

        doc = (
            await db.execute(select(Document).where(Document.id == doc_uuid))
        ).scalar_one_or_none()
        if doc is None:
            failed_ids.append(doc_id_str)
            continue

        # Remove PDF file from disk
        if doc.file_path and _os.path.exists(doc.file_path):
            try:
                _os.remove(doc.file_path)
            except OSError:
                pass

        await db.delete(doc)
        deleted_count += 1

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
    doc_uuid = uuid.UUID(doc_id)

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
