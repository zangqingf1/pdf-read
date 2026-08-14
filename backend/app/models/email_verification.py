"""Email verification code records — one-time codes for register / password reset.

Only the HMAC-SHA256 digest of a code is stored (see auth.verification),
never the plain code. Rows are short-lived (expire after EMAIL_CODE_TTL_MINUTES)
and are marked consumed on use or invalidation.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class EmailVerification(Base):
    __tablename__ = "email_verifications"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(
        String(200), nullable=False, index=True
    )
    purpose: Mapped[str] = mapped_column(
        String(30), nullable=False, index=True
    )  # "register" | "reset_password"
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    failed_attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now()
    )

    def __repr__(self) -> str:
        return f"<EmailVerification(email={self.email}, purpose={self.purpose})>"
