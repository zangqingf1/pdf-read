"""Email verification codes — generation, hashing, sending, consumption.

Security model:
- Codes are 6-digit numbers from ``secrets`` (cryptographically random).
- Only an HMAC-SHA256 digest (keyed with SECRET_KEY) is stored in the DB —
  a leaked database never reveals a usable code.
- Verification compares digests with ``hmac.compare_digest`` (constant time).
- One-time use: a consumed code can never be reused.
- TTL (default 10 min) and a failed-attempt cap (default 5, after which the
  code is invalidated) limit brute force.
- Per-email rate limits (60s cooldown, max N/hour) are enforced via the DB so
  they work across workers; a best-effort per-IP cap uses in-memory state.

Enumeration hardening: with ``purpose="reset_password"`` the send endpoint
always reports success even when the email is unknown; with
``purpose="register"`` an already-registered email is rejected with 409
(that information is inherent to the registration form anyway).
"""

import asyncio
import hashlib
import hmac
import logging
import secrets
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.email_verification import EmailVerification
from app.services.email_service import (
    EmailServiceError,
    EmailServiceUnavailable,
    build_verification_email,
    send_email,
)

logger = logging.getLogger(__name__)

VALID_PURPOSES = ("register", "reset_password")

# Best-effort per-IP send throttling (in-memory; resets on restart).
# Keyed by IP → deque of epoch seconds.
_ip_send_log: dict[str, deque[float]] = defaultdict(deque)


def generate_code() -> str:
    """Generate a cryptographically random numeric code."""
    length = settings.EMAIL_CODE_LENGTH
    return "".join(str(secrets.randbelow(10)) for _ in range(length))


def hash_code(code: str) -> str:
    """HMAC-SHA256 digest of the code, keyed with SECRET_KEY."""
    return hmac.new(
        settings.SECRET_KEY.encode("utf-8"), code.encode("utf-8"), hashlib.sha256
    ).hexdigest()


def verify_code(raw_code: str, stored_hash: str) -> bool:
    """Constant-time comparison of a submitted code against a stored digest."""
    return hmac.compare_digest(hash_code(raw_code), stored_hash)


def _utcnow() -> datetime:
    """Naive UTC now — DB DateTime columns are timezone-less (SQLite & PG)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def _count_sends(db: AsyncSession, email: str, since: datetime) -> int:
    stmt = select(func.count(EmailVerification.id)).where(
        EmailVerification.email == email,
        EmailVerification.created_at >= since,
    )
    return (await db.execute(stmt)).scalar() or 0


def _check_ip_limit(ip: str) -> None:
    """Best-effort per-IP hourly cap using in-memory state."""
    window = 3600.0
    now = time.time()
    q = _ip_send_log[ip]
    while q and now - q[0] > window:
        q.popleft()
    if len(q) >= settings.EMAIL_MAX_PER_IP_PER_HOUR:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="发送过于频繁，请稍后再试。",
        )
    q.append(now)
    # Opportunistic cleanup of stale IP buckets (keep the dict bounded).
    if len(_ip_send_log) > 10000:
        for key in list(_ip_send_log.keys()):
            if not _ip_send_log[key]:
                del _ip_send_log[key]


async def send_verification_code(
    db: AsyncSession, email: str, purpose: str, ip: str | None = None
) -> dict:
    """Generate, persist and email a verification code.

    Raises HTTPException (400/409/429/502/503) on any failure. Returns a
    dict with ``message``, ``cooldown_seconds`` and (dev-only) ``dev_code``.
    """
    if purpose not in VALID_PURPOSES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"purpose 必须是 {' 或 '.join(VALID_PURPOSES)} 之一。",
        )

    email = email.lower().strip()
    now = _utcnow()

    # ── Enumeration / preconditions ──
    from app.models.user import User  # local import to avoid cycles

    existing = (
        await db.execute(select(User.id).where(User.email == email))
    ).scalar_one_or_none()
    if purpose == "register" and existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="该邮箱已注册，请直接登录。",
        )

    # ── Rate limits ──
    # 60s cooldown: the most recent code for this email must be older than the
    # cooldown window (the last send is the newest row for this email).
    last_row = (
        await db.execute(
            select(EmailVerification)
            .where(
                EmailVerification.email == email,
                EmailVerification.purpose == purpose,
            )
            .order_by(EmailVerification.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if last_row is not None:
        elapsed = (now - last_row.created_at).total_seconds()
        remaining = settings.EMAIL_SEND_COOLDOWN_SECONDS - int(elapsed)
        if remaining > 0:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"发送过于频繁，请在 {remaining} 秒后重试。",
            )

    hourly = await _count_sends(db, email, now - timedelta(hours=1))
    if hourly >= settings.EMAIL_MAX_PER_HOUR:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="该邮箱发送次数已达上限，请一小时后重试。",
        )

    if ip:
        _check_ip_limit(ip)

    # ── Generate & persist (hash only) ──
    code = generate_code()
    row = EmailVerification(
        email=email,
        purpose=purpose,
        code_hash=hash_code(code),
        expires_at=now + timedelta(minutes=settings.EMAIL_CODE_TTL_MINUTES),
    )
    db.add(row)
    await db.flush()  # assign row.id before referencing it below
    # Invalidate any older unconsumed codes for the same email+purpose
    # (mark consumed rather than delete — the rows still count toward the
    # hourly rate limit and provide an audit trail).
    await db.execute(
        update(EmailVerification)
        .where(
            EmailVerification.email == email,
            EmailVerification.purpose == purpose,
            EmailVerification.consumed_at.is_(None),
            EmailVerification.id != row.id,
        )
        .values(consumed_at=now)
    )
    # Opportunistic cleanup: drop rows older than 24h for this email.
    await db.execute(
        delete(EmailVerification).where(
            EmailVerification.email == email,
            EmailVerification.created_at < now - timedelta(hours=24),
        )
    )
    await db.flush()

    # ── Send ──
    subject, text_body, html_body = build_verification_email(
        email, code, settings.EMAIL_CODE_TTL_MINUTES, purpose
    )
    try:
        await _send_async_safe(email, subject, text_body, html_body)
    except EmailServiceUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="邮件服务未配置，暂时无法发送验证码，请联系管理员。",
        )
    except EmailServiceError as exc:
        logger.error("Failed to send verification code to %s: %s", email, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="验证码邮件发送失败，请稍后重试。",
        )

    payload: dict = {
        "message": "验证码已发送，请查收邮件。",
        "cooldown_seconds": settings.EMAIL_SEND_COOLDOWN_SECONDS,
    }
    # Dev-only: expose the code so the flow can be tested without SMTP.
    # Requires DEBUG as well — a production box accidentally left in
    # development mode must not hand out verification codes to callers.
    if settings.ENVIRONMENT.lower() == "development" and settings.DEBUG:
        payload["dev_code"] = code
    return payload


async def _send_async_safe(
    email: str, subject: str, text_body: str, html_body: str | None
) -> None:
    """Wrapper so tests can monkeypatch a single point (sync ok — smtplib)."""
    # send_email does blocking SMTP I/O — run it off the event loop.
    await asyncio.to_thread(send_email, email, subject, text_body, html_body)


async def consume_verification_code(
    db: AsyncSession, email: str, purpose: str, code: str
) -> EmailVerification:
    """Validate and consume a verification code (single use).

    Raises HTTPException (400) with a user-friendly Chinese message on any
    failure. On success the row is marked consumed (flushed, not committed —
    the caller's transaction commits it together with its own changes).
    """
    email = email.lower().strip()
    row = (
        await db.execute(
            select(EmailVerification)
            .where(
                EmailVerification.email == email,
                EmailVerification.purpose == purpose,
                EmailVerification.consumed_at.is_(None),
            )
            .order_by(EmailVerification.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="验证码错误或已失效，请重新获取。",
        )

    if row.expires_at < _utcnow():
        row.consumed_at = _utcnow()  # invalidate expired code
        await db.flush()
        # Commit the invalidation before raising: get_db would otherwise
        # roll back this write along with the HTTPException.
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="验证码已过期，请重新获取。",
        )

    if row.failed_attempts >= settings.EMAIL_CODE_MAX_ATTEMPTS:
        row.consumed_at = _utcnow()  # invalidate exhausted code
        await db.flush()
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="验证码尝试次数过多，已失效，请重新获取。",
        )

    if not verify_code(code, row.code_hash):
        row.failed_attempts += 1
        if row.failed_attempts >= settings.EMAIL_CODE_MAX_ATTEMPTS:
            row.consumed_at = _utcnow()  # invalidate on final failure
        await db.flush()
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="验证码错误，请重新输入。",
        )

    row.consumed_at = _utcnow()
    await db.flush()
    return row
