"""Auth API routes — email-verified registration, login, password reset, profile.

Security notes:
- Registration requires a verified email code (single-use, HMAC-hashed,
  TTL-limited — see app.auth.verification).
- Passwords are double-checked (两次输入一致 + 强度策略 + bcrypt 72 字节上限).
- Login is throttled per email+IP (app.auth.rate_limit) and the failure
  message is deliberately generic to avoid account enumeration.
- Password-reset send never reveals whether an email is registered.
- Avatars are uploaded files only (whitelist + magic-byte sniffing, size
  cap, random filenames); arbitrary URL strings are not accepted.
"""

import asyncio
import uuid

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.auth.rate_limit import (
    check_login_attempts,
    record_login_failure,
    record_login_success,
)
from app.auth.schemas import (
    LoginRequest,
    ProfileUpdateRequest,
    RegisterRequest,
    ResetPasswordConfirmRequest,
    SendCodeRequest,
    TokenResponse,
    UserResponse,
)
from app.auth.security import create_access_token, hash_password, verify_password
from app.auth.verification import consume_verification_code, send_verification_code
from app.database import get_db
from app.models.user import User
from app.services import avatar_service

router = APIRouter()


def _client_ip(request: Request) -> str:
    """Best-effort client IP.

    Behind nginx the real client is the leftmost entry of X-Forwarded-For;
    without that header fall back to the socket peer address.
    """
    forwarded = request.headers.get("x-forwarded-for") if hasattr(request, "headers") else None
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    return request.client.host if request.client else "unknown"


def _is_strong_password(password: str) -> bool:
    """Password policy: >= 8 chars with at least 1 letter and 1 digit."""
    if len(password) < 8:
        return False
    has_letter = any(c.isalpha() for c in password)
    has_digit = any(c.isdigit() for c in password)
    return has_letter and has_digit


def _validate_new_password(password: str, password_confirm: str) -> None:
    """Validate the double-entered new password; raise 422 on any violation."""
    if password != password_confirm:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="两次输入的密码不一致。",
        )
    if not _is_strong_password(password):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="密码至少 8 位，且包含至少 1 个字母和 1 个数字。",
        )
    if len(password.encode("utf-8")) > 72:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="密码过长（bcrypt 上限 72 字节），请缩短。",
        )


def _validate_nickname(nickname: str) -> str:
    """Trim and validate a username/nickname; return the cleaned value."""
    cleaned = nickname.strip()
    if any(ord(ch) < 32 for ch in cleaned):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="用户名包含非法字符。",
        )
    return cleaned[:100]


# ── Verification code ──

@router.post("/verification-code/send")
async def send_verification_code_endpoint(
    body: SendCodeRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Send a verification code to the email for register / reset_password."""
    return await send_verification_code(
        db, body.email, body.purpose, ip=_client_ip(request)
    )


# ── Registration (email-verified) ──

@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """Register with email + verification code + custom username + password."""
    email = body.email.lower().strip()

    # Email uniqueness (checked before consuming the code).
    stmt = select(User).where(User.email == email)
    if (await db.execute(stmt)).scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="该邮箱已注册，请直接登录。",
        )

    _validate_new_password(body.password, body.password_confirm)

    # Verify the email belongs to the user (single-use code).
    await consume_verification_code(db, email, "register", body.verification_code)

    nickname = _validate_nickname(body.nickname) if body.nickname else email.split("@")[0]

    user = User(
        email=email,
        nickname=nickname,
        hashed_password=await asyncio.to_thread(hash_password, body.password),
        is_active=True,
        is_verified=True,  # email proof is the verification code itself
    )
    db.add(user)
    try:
        await db.flush()
    except IntegrityError:
        # Concurrent registration race — unique(email) wins.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="该邮箱已注册，请直接登录。",
        )
    await db.refresh(user)

    # Auto-login: issue token
    token = create_access_token(data={"sub": str(user.id), "ver": user.token_version})
    return TokenResponse.from_user(user, token)


# ── Login (throttled) ──

@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Login with email and password. Returns a JWT token."""
    email = body.email.lower().strip()
    ip = _client_ip(request)

    # Brute-force throttle (per email+IP).
    check_login_attempts(email, ip)

    stmt = select(User).where(User.email == email)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if user is None:
        record_login_failure(email, ip)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="邮箱或密码错误。",
        )

    password_ok = await asyncio.to_thread(
        verify_password, body.password, user.hashed_password
    )
    if not password_ok:
        record_login_failure(email, ip)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="邮箱或密码错误。",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="该账号已被禁用，请联系管理员。",
        )

    record_login_success(email, ip)

    # Issue token
    token = create_access_token(data={"sub": str(user.id), "ver": user.token_version})
    return TokenResponse.from_user(user, token)


# ── Password reset (forgot password) ──

@router.post("/password-reset/send")
async def send_password_reset_code(
    body: SendCodeRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Send a password-reset code. Always succeeds for unknown emails
    (no account enumeration)."""
    return await send_verification_code(
        db, body.email, "reset_password", ip=_client_ip(request)
    )


@router.post("/password-reset/confirm")
async def reset_password_confirm(
    body: ResetPasswordConfirmRequest,
    db: AsyncSession = Depends(get_db),
):
    """Set a new password using a verified reset code."""
    email = body.email.lower().strip()
    _validate_new_password(body.new_password, body.password_confirm)

    user = (
        await db.execute(select(User).where(User.email == email))
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="验证码错误或账号不存在。",
        )

    await consume_verification_code(db, email, "reset_password", body.code)

    user.hashed_password = await asyncio.to_thread(hash_password, body.new_password)
    user.token_version += 1  # invalidate all previously issued JWTs
    await db.flush()
    return {"message": "密码已重置，请使用新密码登录。"}


# ── Profile ──

@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    """Return the current authenticated user's profile."""
    return UserResponse.from_user(current_user)


@router.put("/profile", response_model=UserResponse)
async def update_profile(
    body: ProfileUpdateRequest,
    current_user: User = Depends(get_current_user),
):
    """Update the current user's public profile (username)."""
    if body.nickname is not None:
        current_user.nickname = _validate_nickname(body.nickname) or None
    return UserResponse.from_user(current_user)


# ── Avatar ──

@router.post("/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload / replace the current user's avatar image."""
    old_url = current_user.avatar_url
    rel_path = await avatar_service.save_avatar(file, str(current_user.id))
    current_user.avatar_url = rel_path
    try:
        await db.flush()
    except Exception:
        avatar_service.delete_avatar_file(rel_path)  # cleanup orphan file
        raise
    # Remove the old file only after the new one is persisted.
    avatar_service.delete_avatar_file(old_url)
    return UserResponse.from_user(current_user)


@router.delete("/avatar")
async def remove_avatar(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove the current user's avatar."""
    old_url = current_user.avatar_url
    current_user.avatar_url = None
    await db.flush()
    avatar_service.delete_avatar_file(old_url)
    return {"message": "头像已删除。"}


@router.get("/avatar/{user_id}")
async def get_avatar(user_id: str, db: AsyncSession = Depends(get_db)):
    """Serve a user's avatar image (public)."""
    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="头像不存在。",
        )
    user = (
        await db.execute(select(User).where(User.id == uid))
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="头像不存在。",
        )
    path = avatar_service.resolve_avatar_path(user.avatar_url)
    if path is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="头像不存在。",
        )
    media_type = avatar_service.AVATAR_MEDIA_TYPES.get(
        path.suffix.lower(), "application/octet-stream"
    )
    return FileResponse(path, media_type=media_type)
