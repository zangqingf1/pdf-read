"""User model — authentication and data ownership."""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Integer, String, DateTime, Uuid, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.document import Document


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(
        String(200), unique=True, nullable=False, index=True
    )
    nickname: Mapped[str | None] = mapped_column(String(100))
    avatar_url: Mapped[str | None] = mapped_column(String(500))
    hashed_password: Mapped[str] = mapped_column(
        String(255), nullable=False, default=""
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("1")
    )
    is_verified: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("0")
    )
    is_superuser: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("0")
    )
    # Bumped on password reset so previously issued JWTs are rejected.
    token_version: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    documents: Mapped[list["Document"]] = relationship(
        "Document", back_populates="owner", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<User(id={self.id}, email={self.email})>"
