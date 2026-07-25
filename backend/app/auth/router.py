"""Auth API routes — registration, login, and current user."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.auth.schemas import LoginRequest, RegisterRequest, TokenResponse, UserResponse
from app.auth.security import create_access_token, hash_password, verify_password
from app.database import get_db
from app.models.user import User

router = APIRouter()


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """Register a new user account. Returns a JWT token (auto-login)."""
    # Normalize email
    email = body.email.lower().strip()

    # Check email uniqueness
    stmt = select(User).where(User.email == email)
    result = await db.execute(stmt)
    if result.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        )

    # Validate password strength: at least 8 chars, 1 letter + 1 digit
    if not _is_strong_password(body.password):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Password must be at least 8 characters with at least 1 letter and 1 digit.",
        )

    # Create user
    user = User(
        email=email,
        nickname=body.nickname or email.split("@")[0],
        hashed_password=hash_password(body.password),
        is_active=True,
        is_verified=True,  # No email verification in MVP
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)

    # Auto-login: issue token
    token = create_access_token(data={"sub": str(user.id)})
    return TokenResponse.from_user(user, token)


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    """Login with email and password. Returns a JWT token."""
    # Normalize email
    email = body.email.lower().strip()

    # Look up user
    stmt = select(User).where(User.email == email)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if user is None or not verify_password(body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is deactivated.",
        )

    # Issue token
    token = create_access_token(data={"sub": str(user.id)})
    return TokenResponse.from_user(user, token)


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    """Return the current authenticated user's profile."""
    return UserResponse.from_user(current_user)


def _is_strong_password(password: str) -> bool:
    """Check that password is >= 8 chars with at least 1 letter and 1 digit."""
    if len(password) < 8:
        return False
    has_letter = any(c.isalpha() for c in password)
    has_digit = any(c.isdigit() for c in password)
    return has_letter and has_digit
