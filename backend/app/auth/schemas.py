"""Auth schemas — Pydantic models for registration, login, and user responses."""

from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


_PASSWORD_FIELD = dict(
    min_length=8,
    max_length=128,
    description="Password (minimum 8 characters, at least 1 letter + 1 digit)",
)


class RegisterRequest(BaseModel):
    """Request body for user registration (email-verification required)."""

    email: EmailStr
    password: str = Field(**_PASSWORD_FIELD)
    password_confirm: str = Field(**_PASSWORD_FIELD)
    verification_code: str = Field(min_length=4, max_length=12)
    nickname: str | None = Field(default=None, max_length=100)


class LoginRequest(BaseModel):
    """Request body for user login."""

    email: EmailStr
    password: str


class SendCodeRequest(BaseModel):
    """Request body for sending an email verification code."""

    email: EmailStr
    purpose: str  # validated in auth.verification (register | reset_password)


class ResetPasswordConfirmRequest(BaseModel):
    """Request body for resetting the password with a verification code."""

    email: EmailStr
    code: str = Field(min_length=4, max_length=12)
    new_password: str = Field(**_PASSWORD_FIELD)
    password_confirm: str = Field(**_PASSWORD_FIELD)


class ProfileUpdateRequest(BaseModel):
    """Request body for updating the current user's public profile."""

    nickname: str | None = Field(default=None, max_length=100)


class TokenResponse(BaseModel):
    """Response containing JWT access token and user info."""

    access_token: str
    token_type: str = "bearer"
    user_id: str
    email: str
    nickname: str | None = None
    avatar_url: str | None = None
    is_superuser: bool = False

    @classmethod
    def from_user(cls, user, access_token: str) -> "TokenResponse":
        return cls(
            access_token=access_token,
            token_type="bearer",
            user_id=str(user.id),
            email=user.email,
            nickname=user.nickname,
            avatar_url=user.avatar_url,
            is_superuser=user.is_superuser,
        )


class UserResponse(BaseModel):
    """Public user profile returned by /auth/me."""

    id: str
    email: str
    nickname: str | None = None
    avatar_url: str | None = None
    is_active: bool = True
    is_superuser: bool = False
    created_at: datetime

    @classmethod
    def from_user(cls, user) -> "UserResponse":
        return cls(
            id=str(user.id),
            email=user.email,
            nickname=user.nickname,
            avatar_url=user.avatar_url,
            is_active=user.is_active,
            is_superuser=user.is_superuser,
            created_at=user.created_at,
        )
