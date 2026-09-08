"""SRS scheduling — simplified SM-2 with Anki-style four-button ratings.

Pure functions only: the API layer owns persistence, this module owns the
scheduling math so it can be unit-tested without a database.

Ratings: 0=忘了(again) 1=困难(hard) 2=良好(good) 3=简单(easy)

Learning phase (new card or interval < 1 day):
  again/hard → back to the 10-minute step; good → graduate at 1 day;
  easy → graduate at 4 days.
Review phase:
  again → relearn (10-minute step), ease −0.20, lapses+1;
  hard  → interval × 1.2, ease −0.15;
  good  → interval × ease;
  easy  → interval × ease × 1.3, ease +0.15.
Ease is clamped to [1.3, 3.0]; intervals capped at 365 days. An interval of
21+ days automatically promotes the card to 'mastered'.

All datetimes are naive local time (matching how srs_due_at is written);
nothing here converts timezones.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

RATING_AGAIN = 0
RATING_HARD = 1
RATING_GOOD = 2
RATING_EASY = 3

LEARNING_STEP = timedelta(minutes=10)
# Store intervals in days so a 10-minute step is representable.
LEARNING_STEP_DAYS = LEARNING_STEP.total_seconds() / 86400.0

GRADUATING_INTERVAL_DAYS = 1.0
EASY_INTERVAL_DAYS = 4.0
HARD_FACTOR = 1.2
EASY_BONUS = 1.3
MIN_EASE = 1.3
MAX_EASE = 3.0
MAX_INTERVAL_DAYS = 365.0
# Reaching this interval auto-promotes the card out of the queue.
MASTERED_INTERVAL_DAYS = 21.0

STATUS_ACTIVE = "active"
STATUS_MASTERED = "mastered"


@dataclass
class SrsState:
    """Current scheduling state of one card (mirrors the DB columns)."""

    due_at: datetime | None
    interval_days: float
    ease: float
    reps: int
    lapses: int
    status: str

    @classmethod
    def new_card(cls) -> "SrsState":
        return cls(None, 0.0, 2.5, 0, 0, STATUS_ACTIVE)


def is_learning(state: SrsState) -> bool:
    """True while the card sits on sub-day steps (new or relearning)."""
    return state.reps == 0 or state.interval_days < 1.0


def _clamp_ease(ease: float) -> float:
    return max(MIN_EASE, min(MAX_EASE, ease))


def next_state(state: SrsState, rating: int, now: datetime) -> SrsState:
    """Apply one review rating, returning the updated scheduling state."""
    if rating not in (RATING_AGAIN, RATING_HARD, RATING_GOOD, RATING_EASY):
        raise ValueError(f"invalid SRS rating: {rating!r}")

    ease = _clamp_ease(state.ease)
    lapses = state.lapses
    reps = state.reps + 1

    if is_learning(state):
        if rating in (RATING_AGAIN, RATING_HARD):
            interval = LEARNING_STEP_DAYS
        elif rating == RATING_GOOD:
            interval = GRADUATING_INTERVAL_DAYS
        else:  # easy
            interval = EASY_INTERVAL_DAYS
    else:
        if rating == RATING_AGAIN:
            lapses += 1
            ease -= 0.20
            interval = LEARNING_STEP_DAYS
        elif rating == RATING_HARD:
            ease -= 0.15
            interval = state.interval_days * HARD_FACTOR
        elif rating == RATING_GOOD:
            interval = state.interval_days * ease
        else:  # easy
            ease += 0.15
            interval = state.interval_days * ease * EASY_BONUS

    ease = _clamp_ease(ease)
    interval = min(max(interval, LEARNING_STEP_DAYS), MAX_INTERVAL_DAYS)
    due_at = now + timedelta(days=interval)
    status = STATUS_MASTERED if interval >= MASTERED_INTERVAL_DAYS else STATUS_ACTIVE
    return SrsState(due_at, interval, ease, reps, lapses, status)


def _format_delay(days: float) -> str:
    minutes = days * 1440
    if minutes < 60:
        return f"{round(minutes)} 分钟"
    if days < 30:
        return f"{round(days)} 天"
    if days < 365:
        return f"{days / 30.4:.1f} 个月"
    return f"{days / 365:.1f} 年"


def preview_intervals(state: SrsState) -> dict[int, str]:
    """Humanized next-interval preview for each rating button (display only —
    the authoritative schedule is computed by next_state on the server)."""
    return {r: _format_delay(next_state(state, r, _EPOCH).interval_days) for r in range(4)}


_EPOCH = datetime(2000, 1, 1)
