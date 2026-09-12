"""测试：MinerU Token 未配置时解析入口前置拦截。

背景：解析全程依赖用户自填的 MinerU Token，缺失时后台任务只会把文档置为
failed，用户看到的是笼统的「解析失败」。要求在建文档 / 改状态 / 起后台任务
之前就返回 400 与可操作的提示。

全部离线：in-memory SQLite（StaticPool）+ 直接调用路由函数（与 test_auth.py
同一模式）；不触发真实文件保存或 MinerU 调用。
"""

import io
import uuid

import pytest
import pytest_asyncio
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool
from starlette.datastructures import UploadFile

from app.api.v1 import pdf as pdf_router
from app.database import Base
from app.models.document import Document
from app.models.user import User
from app.schemas.pdf import ParseUrlRequest, RetryDocumentRequest, SelectPagesRequest

MISSING_TOKEN = pdf_router.MINERU_TOKEN_MISSING


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


@pytest_asyncio.fixture
async def user(db: AsyncSession) -> User:
    """真实 User 行 —— 路由会用 ``user.id`` 做文档归属校验。"""
    row = User(
        id=uuid.uuid4(),
        email="mineru@example.com",
        hashed_password="x",
        is_active=True,
    )
    db.add(row)
    await db.commit()
    return row


async def _make_document(
    db: AsyncSession,
    user: User,
    *,
    parse_status: str,
    page_count: int | None = None,
) -> Document:
    doc = Document(
        id=uuid.uuid4(),
        title="doc",
        original_text="",
        parse_status=parse_status,
        page_count=page_count,
        file_path="C:/tmp/doc.pdf",
        source_type="upload",
        file_ext=".pdf",
        user_id=user.id,
    )
    db.add(doc)
    await db.commit()
    return doc


def _upload_file() -> UploadFile:
    return UploadFile(filename="doc.pdf", file=io.BytesIO(b"%PDF-1.4 fake"))


# ── 纯函数：Token 校验 ─────────────────────────────────────────────


def test_require_mineru_token_rejects_blank():
    for blank in ("", "   ", "\n", None):
        with pytest.raises(HTTPException) as exc:
            pdf_router._require_mineru_token(blank)
        assert exc.value.status_code == 400
        assert exc.value.detail == MISSING_TOKEN


def test_require_mineru_token_trims_and_passes():
    assert pdf_router._require_mineru_token("  abc-token  ") == "abc-token"


# ── POST /pdf/upload ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_upload_without_token_does_not_create_document(db, user, monkeypatch):
    """缺 Token 时必须在保存文件/建文档之前就返回 400。"""

    async def _fail_upload(*args, **kwargs):  # pragma: no cover - 不应被调用
        raise AssertionError("upload_and_save must not run without a token")

    monkeypatch.setattr(pdf_router.pdf_service, "upload_and_save", _fail_upload)

    with pytest.raises(HTTPException) as exc:
        await pdf_router.upload_pdf(BackgroundTasks(), _upload_file(), "", db, user)

    assert exc.value.status_code == 400
    assert exc.value.detail == MISSING_TOKEN


# ── POST /pdf/parse-url ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_parse_url_without_token_does_not_save_document(db, user, monkeypatch):
    async def _fail_save(*args, **kwargs):  # pragma: no cover - 不应被调用
        raise AssertionError("save_url_document must not run without a token")

    monkeypatch.setattr(pdf_router.pdf_service, "save_url_document", _fail_save)

    with pytest.raises(HTTPException) as exc:
        await pdf_router.parse_url_document(
            BackgroundTasks(),
            ParseUrlRequest(url="https://example.com/a.pdf", mineru_token=""),
            db,
            user,
        )

    assert exc.value.status_code == 400
    assert exc.value.detail == MISSING_TOKEN


# ── POST /pdf/select-pages ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_select_pages_without_token_keeps_awaiting_selection(db, user):
    """缺 Token 时不得把状态推进到 processing，否则前端会一直轮询到 failed。"""
    doc = await _make_document(db, user, parse_status="awaiting_selection", page_count=5)
    background = BackgroundTasks()

    with pytest.raises(HTTPException) as exc:
        await pdf_router.select_pages(
            background,
            SelectPagesRequest(task_id=str(doc.id), selected_pages=[1], mineru_token=""),
            db,
            user,
        )

    assert exc.value.status_code == 400
    assert exc.value.detail == MISSING_TOKEN
    assert background.tasks == []
    await db.refresh(doc)
    assert doc.parse_status == "awaiting_selection"


@pytest.mark.asyncio
async def test_select_pages_with_token_starts_processing(db, user):
    doc = await _make_document(db, user, parse_status="awaiting_selection", page_count=5)
    background = BackgroundTasks()

    response = await pdf_router.select_pages(
        background,
        SelectPagesRequest(task_id=str(doc.id), selected_pages=[1], mineru_token=" tok "),
        db,
        user,
    )

    assert response.status == "processing"
    assert len(background.tasks) == 1
    # Token 已去除首尾空白后传给后台任务
    assert background.tasks[0].args[-1] == "tok"
    await db.refresh(doc)
    assert doc.parse_status == "processing"


# ── POST /pdf/retry/{task_id} ──────────────────────────────────────


@pytest.mark.asyncio
async def test_retry_without_token_does_not_start_parse(db, user):
    """非 PDF（页数未知）失败文档重试同样要拦住，而不是起一个注定失败的任务。"""
    doc = await _make_document(db, user, parse_status="failed", page_count=None)
    background = BackgroundTasks()

    with pytest.raises(HTTPException) as exc:
        await pdf_router.retry_document(
            background, str(doc.id), db, user, RetryDocumentRequest(mineru_token="")
        )

    assert exc.value.status_code == 400
    assert exc.value.detail == MISSING_TOKEN
    assert background.tasks == []
    await db.refresh(doc)
    assert doc.parse_status == "failed"


@pytest.mark.asyncio
async def test_retry_awaiting_selection_without_token_still_resumes(db, user):
    """awaiting_selection 的重试只是回传页数让前端回到选页，仍应放行。"""
    doc = await _make_document(db, user, parse_status="awaiting_selection", page_count=3)
    background = BackgroundTasks()

    response = await pdf_router.retry_document(
        background, str(doc.id), db, user, RetryDocumentRequest(mineru_token="")
    )

    assert response.status == "awaiting_selection"
    assert response.page_count == 3
    assert background.tasks == []
