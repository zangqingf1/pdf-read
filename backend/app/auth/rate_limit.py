"""In-memory brute-force throttling for the login endpoint.

Keyed by ``email|ip``: after ``LOGIN_MAX_ATTEMPTS`` failed attempts within
``LOGIN_ATTEMPT_WINDOW_MINUTES`` the client is refused with 429 (with the
remaining lockout seconds). A successful login clears the counter.

Note: state is per-process — with multiple API workers, a restart resets the
counters. Acceptable for this deployment (single uvicorn worker + dedicated
Celery workers); swap for Redis if scaling out.
"""

import time
from collections import defaultdict, deque
from datetime import timedelta

from fastapi import HTTPException, status

from app.config import settings

# key -> deque of failure timestamps (epoch seconds)
_failures: dict[str, deque[float]] = defaultdict(deque)


def _key(email: str, ip: str) -> str:
    return f"{email.lower().strip()}|{ip or 'unknown'}"


def _now() -> float:
    return time.time()


def check_login_attempts(email: str, ip: str) -> None:
    """Raise 429 if the email+IP pair is currently locked out."""
    window = settings.LOGIN_ATTEMPT_WINDOW_MINUTES * 60
    q = _failures[_key(email, ip)]
    cutoff = _now() - window
    while q and q[0] < cutoff:
        q.popleft()

    if len(q) >= settings.LOGIN_MAX_ATTEMPTS:
        retry_in = max(1, int(q[0] + window - _now()))
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"登录失败次数过多，请 {retry_in} 秒后重试。",
        )


def record_login_failure(email: str, ip: str) -> None:
    """Record a failed attempt (only counts while under the window)."""
    window = settings.LOGIN_ATTEMPT_WINDOW_MINUTES * 60
    key = _key(email, ip)
    q = _failures[key]
    now = _now()
    while q and q[0] < now - window:
        q.popleft()
    q.append(now)
    # Bounded growth: drop empty buckets occasionally.
    if len(_failures) > 10000:
        for k in list(_failures.keys()):
            if not _failures[k]:
                del _failures[k]


def record_login_success(email: str, ip: str) -> None:
    """Clear the failure counter after a successful login."""
    _failures[_key(email, ip)].clear()


def remaining_lockout(email: str, ip: str) -> int:
    """Seconds until the current lockout expires (0 if not locked out)."""
    window = settings.LOGIN_ATTEMPT_WINDOW_MINUTES * 60
    q = _failures[_key(email, ip)]
    if len(q) < settings.LOGIN_MAX_ATTEMPTS:
        return 0
    return max(0, int(q[0] + window - _now()))


def format_lockout_message(seconds: int) -> str:
    """Human-readable Chinese message for a lockout duration."""
    delta = timedelta(seconds=seconds)
    total_minutes = int(delta.total_seconds() // 60)
    if total_minutes >= 1:
        return f"登录失败次数过多，请在 {total_minutes} 分钟后重试。"
    return f"登录失败次数过多，请 {max(1, seconds)} 秒后重试。"
