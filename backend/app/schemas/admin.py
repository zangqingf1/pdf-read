"""Admin schemas — Pydantic models for admin dashboard, user & document management."""

from datetime import datetime

from pydantic import BaseModel, Field


# ── Dashboard Stats ──

class AdminStats(BaseModel):
    """Dashboard summary statistics."""

    total_users: int
    total_documents: int
    today_users: int
    today_documents: int


# ── User Management ──

class AdminUserItem(BaseModel):
    """A single user row in the admin user list."""

    id: str
    email: str
    nickname: str | None = None
    is_active: bool
    is_superuser: bool
    document_count: int
    created_at: datetime

    @classmethod
    def from_user(cls, user, document_count: int) -> "AdminUserItem":
        return cls(
            id=str(user.id),
            email=user.email,
            nickname=user.nickname,
            is_active=user.is_active,
            is_superuser=user.is_superuser,
            document_count=document_count,
            created_at=user.created_at,
        )


class AdminUserListResponse(BaseModel):
    """Paginated user list."""

    users: list[AdminUserItem]
    total: int


class AdminUserUpdateRequest(BaseModel):
    """Fields the admin may update on a user."""

    is_active: bool | None = None
    is_superuser: bool | None = None


# ── Document Management ──

class AdminDocumentItem(BaseModel):
    """A single document row in the admin document list."""

    id: str
    title: str | None = None
    owner_email: str
    owner_nickname: str | None = None
    parse_status: str
    page_count: int | None = None
    word_count: int | None = None
    source_type: str | None = None
    file_ext: str | None = None
    created_at: datetime

    @classmethod
    def from_document(cls, doc, owner_email: str, owner_nickname: str | None) -> "AdminDocumentItem":
        return cls(
            id=str(doc.id),
            title=doc.title,
            owner_email=owner_email,
            owner_nickname=owner_nickname,
            parse_status=doc.parse_status,
            page_count=doc.page_count,
            word_count=doc.word_count,
            source_type=doc.source_type,
            file_ext=doc.file_ext,
            created_at=doc.created_at,
        )


class AdminDocumentListResponse(BaseModel):
    """Paginated document list (all users)."""

    documents: list[AdminDocumentItem]
    total: int


class AdminBatchDeleteRequest(BaseModel):
    """Batch delete request for admin document management."""

    document_ids: list[str] = Field(..., min_length=1, max_length=100)


class AdminBatchDeleteResponse(BaseModel):
    """Batch delete result."""

    deleted_count: int
    failed_ids: list[str] = Field(default_factory=list)
    message: str


# ── Daily Quote Management ──

class AdminQuoteItem(BaseModel):
    """A single daily-quote row in the admin quote list."""

    id: int
    text_en: str
    text_zh: str
    author: str
    active: bool
    created_at: datetime

    @classmethod
    def from_quote(cls, q) -> "AdminQuoteItem":
        return cls(
            id=q.id,
            text_en=q.text_en,
            text_zh=q.text_zh,
            author=q.author,
            active=q.active,
            created_at=q.created_at,
        )


class AdminQuoteListResponse(BaseModel):
    """Paginated daily-quote list."""

    quotes: list[AdminQuoteItem]
    total: int


class AdminQuoteCreateRequest(BaseModel):
    """Fields required to create a daily quote."""

    text_en: str = Field(..., min_length=1, max_length=2000)
    text_zh: str = Field("", max_length=2000)
    author: str = Field("", max_length=200)
    active: bool = True


class AdminQuoteUpdateRequest(BaseModel):
    """Fields the admin may update on a daily quote."""

    text_en: str | None = Field(None, min_length=1, max_length=2000)
    text_zh: str | None = Field(None, max_length=2000)
    author: str | None = Field(None, max_length=200)
    active: bool | None = None
