"""In-memory brute-force throttling for the login endpoint.

Two bucket dimensions, both capped at ``LOGIN_MAX_ATTEMPTS`` failures within
``LOGIN_ATTEMPT_WINDOW_MINUTES``:

- ``email|ip`` — per client; a successful login clears it.
- ``email`` — global per-account bucket that no IP rotation can evade
  (guards against attackers forging X-Forwarded-For or botnets).

A successful login clears both. Note: state is per-process — with multiple
API workers, a restart resets the counters. Acceptable for this deployment
(single uvicorn worker + dedicated Celery workers); swap for Redis if
scaling out.
"""

import time
from collections import deque
from datetime import timedelta

from fastapi import HTTPException, status

from app.config import settings

# key -> deque of failure timestamps (epoch seconds)
_failures: dict[str, deque[float]] = {}
# global per-email bucket: email -> deque of failure timestamps
_email_failures: dict[str, deque[float]] = {}


def _key(email: str, ip: str) -> str:
    return f"{email.lower().strip()}|{ip or 'unknown'}"


def _email_key(email: str) -> str:
    return email.lower().strip()


def _prune(q: deque[float], cutoff: float) -> None:
    while q and q[0] < cutoff:
        q.popleft()


def _now() -> float:
    return time.time()


def _window() -> float:
    return settings.LOGIN_ATTEMPT_WINDOW_MINUTES * 60


def _cleanup_if_needed(now: float) -> None:
    """Periodically drop empty and fully-expired buckets (prevents memory growth)."""
    if len(_failures) <= 10000:
        return
    cutoff = now - _window()
    for store in (_failures, _email_failures):
        for key in list(store.keys()):
            q = store.get(key)
            if not q or (q[-1] < cutoff):
                store.pop(key, None)


def check_login_attempts(email: str, ip: str) -> None:
    """Raise 429 if the email+IP pair or the email globally is locked out."""
    window = _window()
    now = _now()
    cutoff = now - window

    q = _failures.get(_key(email, ip))
    if q:
        _prune(q, cutoff)

    eq = _email_failures.get(_email_key(email))
    if eq:
        _prune(eq, cutoff)
        # The global bucket wins when both are expired-empty — drop it.
        if not eq:
            _email_failures.pop(_email_key(email), None)

    for bucket in (q, eq):
        if bucket and len(bucket) >= settings.LOGIN_MAX_ATTEMPTS:
            retry_in = max(1, int(bucket[0] + window - now))
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"登录失败次数过多，请 {retry_in} 秒后重试。",
            )


def record_login_failure(email: str, ip: str) -> None:
    """Record a failed attempt (only counts while under the window)."""
    window = _window()
    now = _now()
    for store, key in (
        (_failures, _key(email, ip)),
        (_email_failures, _email_key(email)),
    ):
        q = store.get(key)
        if q is None:
            q = deque()
            store[key] = q
        while q and q[0] < now - window:
            q.popleft()
        q.append(now)
    _cleanup_if_needed(now)


def record_login_success(email: str, ip: str) -> None:
    """Clear the failure counters after a successful login (and free buckets)."""
    _failures.pop(_key(email, ip), None)
    _email_failures.pop(_email_key(email), None)


def remaining_lockout(email: str, ip: str) -> int:
    """Seconds until the current lockout expires (0 if not locked out)."""
    window = _window()
    cutoff = _now() - window
    candidates = []
    q = _failures.get(_key(email, ip))
    if q:
        _prune(q, cutoff)
        candidates.append(q)
    eq = _email_failures.get(_email_key(email))
    if eq:
        _prune(eq, cutoff)
        candidates.append(eq)
    locked = [b for b in candidates if len(b) >= settings.LOGIN_MAX_ATTEMPTS]
    if not locked:
        return 0
    return max(0, int(min(b[0] for b in locked) + window - _now()))


def format_lockout_message(seconds: int) -> str:
    """Human-readable Chinese message for a lockout duration."""
    delta = timedelta(seconds=seconds)
    total_minutes = int(delta.total_seconds() // 60)
    if total_minutes >= 1:
        return f"登录失败次数过多，请在 {total_minutes} 分钟后重试。"
    return f"登录失败次数过多，请 {max(1, seconds)} 秒后重试。"
