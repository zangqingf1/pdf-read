"""SRS scheduling math + queue/review/mastered/stats endpoint flows."""

import uuid
from datetime import datetime, timedelta

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.v1 import srs as srs_module
from app.database import Base
from app.models.user import User
from app.models.vocabulary import VocabularyEntry
from app.schemas.srs import SrsMasteredRequest, SrsReviewRequest
from app.services import srs_service
from app.services.srs_service import SrsState

T0 = datetime(2026, 9, 6, 12, 0, 0)


def _state(interval=0.0, ease=2.5, reps=0, lapses=0, status="active") -> SrsState:
    due = T0 + timedelta(days=interval) if interval else None
    return SrsState(due, interval, ease, reps, lapses, status)


@pytest_asyncio.fixture
async def db():
    test_engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session = async_sessionmaker(
        test_engine, class_=AsyncSession, expire_on_commit=False
    )()
    yield session
    await session.close()
    await test_engine.dispose()


# ── scheduling math ──────────────────────────────────────────────────


def test_new_card_ratings():
    nxt = srs_service.next_state(_state(), 0, T0)
    assert nxt.interval_days == pytest.approx(10 / 1440)
    assert (nxt.due_at - T0) == timedelta(minutes=10)
    assert nxt.status == "active"

    good = srs_service.next_state(_state(), 2, T0)
    assert good.interval_days == 1.0 and good.reps == 1

    easy = srs_service.next_state(_state(), 3, T0)
    assert easy.interval_days == 4.0


def test_graduation_and_review():
    # good → 1 day → good again: interval × ease
    s1 = srs_service.next_state(_state(), 2, T0)
    s2 = srs_service.next_state(s1, 2, T0)
    assert s2.interval_days == pytest.approx(2.5)
    assert s2.status == "active"

    # hard shrinks the multiplier and the ease
    s3 = srs_service.next_state(s2, 1, T0)
    assert s3.interval_days == pytest.approx(2.5 * 1.2)
    assert s3.ease == pytest.approx(2.35)

    # easy bumps ease and applies the bonus
    s4 = srs_service.next_state(s2, 3, T0)
    assert s4.ease == pytest.approx(2.65)
    assert s4.interval_days == pytest.approx(2.5 * 2.65 * 1.3)


def test_lapse_returns_to_learning_step():
    s1 = srs_service.next_state(_state(), 2, T0)
    s2 = srs_service.next_state(s1, 2, T0)  # 2.5-day review card
    lapse = srs_service.next_state(s2, 0, T0)
    assert lapse.lapses == 1
    assert lapse.interval_days == pytest.approx(10 / 1440)
    assert lapse.ease == pytest.approx(2.3)
    assert (lapse.due_at - T0) == timedelta(minutes=10)
    assert srs_service.is_learning(lapse)


def test_ease_clamped_and_auto_mastered():
    # repeated lapses floor the ease at 1.3
    s = _state(interval=30.0, ease=1.4, reps=5)
    after = srs_service.next_state(s, 0, T0)
    assert after.ease == srs_service.MIN_EASE

    # long successful reviews promote the card out of the queue
    s = _state(interval=20.0, ease=2.5, reps=6)
    promoted = srs_service.next_state(s, 2, T0)
    assert promoted.interval_days == pytest.approx(50.0)
    assert promoted.status == "mastered"


def test_invalid_rating_rejected():
    with pytest.raises(ValueError):
        srs_service.next_state(_state(), 9, T0)


# ── endpoint flows ───────────────────────────────────────────────────


async def _make_entry(db, user, word="apple", **srs_kwargs) -> VocabularyEntry:
    entry = VocabularyEntry(
        id=str(uuid.uuid4()),
        user_id=user.id,
        word=word,
        word_original=word.capitalize(),
        **srs_kwargs,
    )
    db.add(entry)
    await db.commit()
    return entry


@pytest.mark.asyncio
async def test_queue_review_mastered_flow(db):
    user = User(id=uuid.uuid4(), email="srs@t.com")
    db.add(user)
    await db.commit()
    fresh = await _make_entry(db, user, "fresh")          # new card → due now
    done = await _make_entry(
        db, user, "done",
        srs_due_at=datetime.now() - timedelta(days=3),
        srs_interval_days=5.0, srs_reps=3, srs_ease=2.4,
    )
    await _make_entry(
        db, user, "later",
        srs_due_at=datetime.now() + timedelta(days=6),
        srs_interval_days=6.0, srs_reps=2,
    )

    queue = await srs_module.get_queue(limit=20, db=db, current_user=user)
    words = [it.word for it in queue.items]
    assert "later" not in words
    assert set(words) == {"fresh", "done"}
    assert queue.counts.due_total == 2
    assert queue.counts.new == 1
    assert queue.counts.review == 1
    assert queue.counts.mastered_total == 0
    # every card ships a rating preview for the four buttons
    assert set(queue.items[0].srs_preview.keys()) == {"0", "1", "2", "3"}

    # review "done" as forgotten → back to the 10-minute learning step
    resp = await srs_module.review_card(
        SrsReviewRequest(entry_id=done.id, rating=0), db, user
    )
    assert resp.entry.srs_lapses == 1
    assert resp.entry.srs_is_learning is True

    # manual mastery removes the card from the queue
    await srs_module.set_mastered(fresh.id, SrsMasteredRequest(mastered=True), db, user)
    queue2 = await srs_module.get_queue(limit=20, db=db, current_user=user)
    assert "fresh" not in [it.word for it in queue2.items]
    assert queue2.counts.mastered_total == 1

    # un-mastering brings it straight back
    await srs_module.set_mastered(fresh.id, SrsMasteredRequest(mastered=False), db, user)
    queue3 = await srs_module.get_queue(limit=20, db=db, current_user=user)
    assert "fresh" in [it.word for it in queue3.items]


@pytest.mark.asyncio
async def test_stats_and_user_isolation(db):
    user_a = User(id=uuid.uuid4(), email="a@t.com")
    user_b = User(id=uuid.uuid4(), email="b@t.com")
    db.add_all([user_a, user_b])
    await db.commit()
    await _make_entry(db, user_a, "apple")
    mine = await _make_entry(db, user_a, "pear")
    await _make_entry(db, user_b, "peach")

    resp = await srs_module.review_card(
        SrsReviewRequest(entry_id=mine.id, rating=2), db, user_a
    )
    assert resp.entry.srs_reps == 1

    stats = await srs_module.get_stats(db, user_a)
    assert stats.total == 2
    assert stats.reviewed_today == 1
    assert stats.due_today == 1  # "apple" untouched, "pear" scheduled +1d
    assert any(f.count > 0 for f in stats.forecast)

    # user_b sees none of user_a's cards
    queue_b = await srs_module.get_queue(limit=20, db=db, current_user=user_b)
    assert [it.word for it in queue_b.items] == ["peach"]
    stats_b = await srs_module.get_stats(db, user_b)
    assert stats_b.total == 1 and stats_b.reviewed_today == 0

    # reset returns the card to fresh state
    reset = await srs_module.reset_card(mine.id, db, user_a)
    assert reset.entry.srs_reps == 0 and reset.entry.srs_due_at is None
