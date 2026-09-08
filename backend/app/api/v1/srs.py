"""SRS review API — due-card queue, rating submission, master/reset, stats."""

import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.vocabulary import _to_out
from app.auth.deps import get_current_user
from app.database import get_db
from app.models.user import User
from app.models.vocabulary import VocabularyEntry
from app.schemas.srs import (
    SrsCardOut,
    SrsCounts,
    SrsForecastItem,
    SrsMasteredRequest,
    SrsQueueResponse,
    SrsReviewRequest,
    SrsReviewResponse,
    SrsStatsResponse,
)
from app.services import srs_service
from app.services.srs_service import SrsState

router = APIRouter()
_logger = logging.getLogger(__name__)


def _now() -> datetime:
    """Naive local time — all srs_due_at values are written in this clock."""
    return datetime.now()


def _to_card_out(entry: VocabularyEntry) -> SrsCardOut:
    base = _to_out(entry).model_dump()
    state = SrsState(
        entry.srs_due_at,
        entry.srs_interval_days or 0.0,
        entry.srs_ease if entry.srs_ease is not None else 2.5,
        entry.srs_reps or 0,
        entry.srs_lapses or 0,
        entry.srs_status or srs_service.STATUS_ACTIVE,
    )
    return SrsCardOut(
        **base,
        srs_is_learning=srs_service.is_learning(state),
        srs_preview={str(r): p for r, p in srs_service.preview_intervals(state).items()},
    )


async def _get_entry(entry_id: str, user: User, db: AsyncSession) -> VocabularyEntry:
    entry = (
        await db.execute(
            select(VocabularyEntry).where(
                VocabularyEntry.id == entry_id, VocabularyEntry.user_id == user.id
            )
        )
    ).scalar_one_or_none()
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    return entry


@router.get("/queue", response_model=SrsQueueResponse)
async def get_queue(
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    now = _now()
    due_cond = (
        VocabularyEntry.user_id == current_user.id,
        VocabularyEntry.srs_status == srs_service.STATUS_ACTIVE,
        or_(
            VocabularyEntry.srs_due_at.is_(None),
            VocabularyEntry.srs_due_at <= now,
        ),
    )
    due_total = (
        await db.execute(select(func.count()).select_from(VocabularyEntry).where(*due_cond))
    ).scalar() or 0

    new_total = (
        await db.execute(
            select(func.count())
            .select_from(VocabularyEntry)
            .where(*due_cond, VocabularyEntry.srs_reps == 0)
        )
    ).scalar() or 0

    learning_total = (
        await db.execute(
            select(func.count())
            .select_from(VocabularyEntry)
            .where(*due_cond, VocabularyEntry.srs_reps > 0, VocabularyEntry.srs_interval_days < 1.0)
        )
    ).scalar() or 0

    mastered_total = (
        await db.execute(
            select(func.count())
            .select_from(VocabularyEntry)
            .where(
                VocabularyEntry.user_id == current_user.id,
                VocabularyEntry.srs_status == srs_service.STATUS_MASTERED,
            )
        )
    ).scalar() or 0

    rows = (
        await db.execute(
            select(VocabularyEntry)
            .where(*due_cond)
            # Learning/new cards (earliest due or never scheduled) surface first;
            # new cards fall back to creation order.
            .order_by(
                func.coalesce(VocabularyEntry.srs_due_at, VocabularyEntry.created_at).asc()
            )
            .limit(limit)
        )
    ).scalars().all()

    counts = SrsCounts(
        new=new_total,
        learning=learning_total,
        review=max(due_total - new_total - learning_total, 0),
        due_total=due_total,
        mastered_total=mastered_total,
    )
    return SrsQueueResponse(items=[_to_card_out(e) for e in rows], counts=counts)


@router.post("/review", response_model=SrsReviewResponse)
async def review_card(
    request: SrsReviewRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    entry = await _get_entry(request.entry_id, current_user, db)
    state = SrsState(
        entry.srs_due_at,
        entry.srs_interval_days or 0.0,
        entry.srs_ease if entry.srs_ease is not None else 2.5,
        entry.srs_reps or 0,
        entry.srs_lapses or 0,
        entry.srs_status or srs_service.STATUS_ACTIVE,
    )
    now = _now()
    nxt = srs_service.next_state(state, request.rating, now)
    entry.srs_due_at = nxt.due_at
    entry.srs_interval_days = nxt.interval_days
    entry.srs_ease = nxt.ease
    entry.srs_reps = nxt.reps
    entry.srs_lapses = nxt.lapses
    entry.srs_status = nxt.status
    entry.srs_last_reviewed_at = now
    await db.commit()
    await db.refresh(entry)  # reload onupdate columns (updated_at) in async context
    return SrsReviewResponse(entry=_to_card_out(entry))


@router.post("/{entry_id}/mastered", response_model=SrsReviewResponse)
async def set_mastered(
    entry_id: str,
    request: SrsMasteredRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    entry = await _get_entry(entry_id, current_user, db)
    if request.mastered:
        entry.srs_status = srs_service.STATUS_MASTERED
    else:
        # Un-mastering brings the card straight back into the queue.
        entry.srs_status = srs_service.STATUS_ACTIVE
        entry.srs_due_at = _now()
    await db.commit()
    await db.refresh(entry)
    return SrsReviewResponse(entry=_to_card_out(entry))


@router.post("/{entry_id}/reset", response_model=SrsReviewResponse)
async def reset_card(
    entry_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    entry = await _get_entry(entry_id, current_user, db)
    entry.srs_due_at = None
    entry.srs_interval_days = 0.0
    entry.srs_ease = 2.5
    entry.srs_reps = 0
    entry.srs_lapses = 0
    entry.srs_status = srs_service.STATUS_ACTIVE
    entry.srs_last_reviewed_at = None
    await db.commit()
    await db.refresh(entry)
    return SrsReviewResponse(entry=_to_card_out(entry))


@router.get("/stats", response_model=SrsStatsResponse)
async def get_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    now = _now()
    rows = (
        await db.execute(
            select(
                VocabularyEntry.srs_status,
                VocabularyEntry.srs_due_at,
                VocabularyEntry.srs_reps,
                VocabularyEntry.srs_last_reviewed_at,
            ).where(VocabularyEntry.user_id == current_user.id)
        )
    ).all()

    total = len(rows)
    mastered = 0
    due_today = 0
    reviewed_today = 0
    today = now.date()
    forecast_raw: dict[str, int] = {}
    for status, due_at, reps, last_reviewed in rows:
        if status == srs_service.STATUS_MASTERED:
            mastered += 1
            continue
        if reps == 0 or due_at is None or due_at <= now:
            due_today += 1
        if due_at is not None:
            key = due_at.date().isoformat()
            forecast_raw[key] = forecast_raw.get(key, 0) + 1
        if last_reviewed is not None and last_reviewed.date() == today:
            reviewed_today += 1

    forecast = [
        SrsForecastItem(date=(today + timedelta(days=i)).isoformat(), count=forecast_raw.get((today + timedelta(days=i)).isoformat(), 0))
        for i in range(7)
    ]
    return SrsStatsResponse(
        total=total,
        active=total - mastered,
        mastered=mastered,
        due_today=due_today,
        reviewed_today=reviewed_today,
        forecast=forecast,
    )
