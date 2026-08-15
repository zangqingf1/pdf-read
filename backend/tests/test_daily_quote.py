"""测试：每日一句 — 确定性取句 / 数据库回退 / 种子填充 / 管理后台 CRUD。

全部离线：in-memory SQLite（StaticPool）+ 直接调用路由/服务函数。
"""

import uuid
from datetime import date

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.v1 import admin as admin_module
from app.api.v1.quote import daily_quote
from app.database import Base
from app.models.daily_quote import DailyQuote
from app.models.user import User
from app.schemas.admin import AdminQuoteCreateRequest, AdminQuoteUpdateRequest
from app.services.daily_quote import (
    DAILY_QUOTES,
    get_daily_quote,
    pick_quote_by_date,
    seed_daily_quotes,
)


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)()
    yield session
    await session.close()
    await engine.dispose()


async def _seed_user(db: AsyncSession, *, superuser: bool = True) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"{uuid.uuid4().hex}@example.com",
        nickname="admin",
        hashed_password="",
        is_active=True,
        is_superuser=superuser,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


# ── 确定性取句（纯函数） ───────────────────────────────────────────


def test_same_date_same_quote():
    day = date(2026, 8, 15)
    assert pick_quote_by_date(day, DAILY_QUOTES) == pick_quote_by_date(day, DAILY_QUOTES)


def test_returns_valid_shape():
    quote = pick_quote_by_date(date(2026, 8, 15), DAILY_QUOTES)
    assert set(quote.keys()) == {"en", "zh", "author"}
    assert quote["en"]
    assert quote["zh"]
    assert quote["author"]


def test_rotates_across_days():
    start = date(2026, 1, 1)
    seen = set()
    for i in range(len(DAILY_QUOTES) * 2):
        quote = pick_quote_by_date(
            date.fromordinal(start.toordinal() + i), DAILY_QUOTES
        )
        seen.add(quote["en"])
    assert len(seen) == len(DAILY_QUOTES)


def test_quote_entries_unique():
    assert len({q["en"] for q in DAILY_QUOTES}) == len(DAILY_QUOTES)


# ── 数据库回退与种子填充 ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_empty_db_falls_back_to_builtin(db):
    quote = await get_daily_quote(date(2026, 8, 15), db)
    assert quote == pick_quote_by_date(date(2026, 8, 15), DAILY_QUOTES)


@pytest.mark.asyncio
async def test_seed_fills_once(db):
    seeded = await seed_daily_quotes(db)
    assert seeded == len(DAILY_QUOTES)
    again = await seed_daily_quotes(db)
    assert again == 0
    total = await db.scalar(text("SELECT count(*) FROM daily_quotes"))
    assert total == len(DAILY_QUOTES)


@pytest.mark.asyncio
async def test_db_quote_returned_when_present(db):
    db.add(DailyQuote(text_en="Custom EN", text_zh="自定义中文", author="Tester", active=True))
    await db.commit()
    quote = await get_daily_quote(date(2026, 8, 15), db)
    assert quote["en"] == "Custom EN"
    assert quote["zh"] == "自定义中文"
    assert quote["author"] == "Tester"


@pytest.mark.asyncio
async def test_inactive_quotes_excluded(db):
    db.add_all(
        [
            DailyQuote(text_en="Active 1", text_zh="a", author="A", active=True),
            DailyQuote(text_en="Active 2", text_zh="b", author="B", active=True),
            DailyQuote(text_en="Inactive", text_zh="c", author="C", active=False),
        ]
    )
    await db.commit()
    for i in range(5):
        quote = await get_daily_quote(date(2026, 1, 1 + i), db)
        assert quote["en"] in {"Active 1", "Active 2"}


# ── 公开端点 ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_quote_endpoint_shape(db):
    await seed_daily_quotes(db)
    resp = await daily_quote(db)
    assert set(resp.keys()) == {"date", "en", "zh", "author"}
    assert resp["date"] == date.today().isoformat()
    assert resp["en"] and resp["zh"] and resp["author"]
    assert resp["en"] == (await get_daily_quote(date.today(), db))["en"]


# ── 管理后台 CRUD ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_admin_create_quote(db):
    user = await _seed_user(db, superuser=True)
    item = await admin_module.create_quote(
        AdminQuoteCreateRequest(text_en="Hello world", text_zh="你好世界", author="Me", active=True),
        db,
        user,
    )
    assert item.text_en == "Hello world"
    assert item.text_zh == "你好世界"
    assert item.author == "Me"
    assert item.active is True


@pytest.mark.asyncio
async def test_admin_update_quote(db):
    user = await _seed_user(db, superuser=True)
    item = await admin_module.create_quote(
        AdminQuoteCreateRequest(text_en="Hello", text_zh="你好", author="A", active=True),
        db,
        user,
    )
    updated = await admin_module.update_quote(
        item.id,
        AdminQuoteUpdateRequest(text_zh="更新中文", active=False),
        db,
        user,
    )
    assert updated.text_zh == "更新中文"
    assert updated.active is False
    assert updated.text_en == "Hello"


@pytest.mark.asyncio
async def test_admin_delete_quote(db):
    user = await _seed_user(db, superuser=True)
    item = await admin_module.create_quote(
        AdminQuoteCreateRequest(text_en="To delete", text_zh="删除", author="A"),
        db,
        user,
    )
    resp = await admin_module.delete_quote(item.id, db, user)
    assert resp["detail"] == "Quote deleted successfully"
    assert await db.get(DailyQuote, item.id) is None


@pytest.mark.asyncio
async def test_admin_list_quotes_with_search(db):
    user = await _seed_user(db, superuser=True)
    await admin_module.create_quote(
        AdminQuoteCreateRequest(text_en="Perseverance wins", text_zh="坚持必胜", author="A"),
        db,
        user,
    )
    await admin_module.create_quote(
        AdminQuoteCreateRequest(text_en="Second", text_zh="第二条", author="B", active=False),
        db,
        user,
    )
    result = await admin_module.list_quotes(search="Perseverance", active=None, limit=20, offset=0, db=db, admin=user)
    assert result.total == 1
    assert result.quotes[0].text_en == "Perseverance wins"

    all_result = await admin_module.list_quotes(search="", active=None, limit=20, offset=0, db=db, admin=user)
    assert all_result.total == 2


@pytest.mark.asyncio
async def test_admin_quote_update_not_found(db):
    user = await _seed_user(db, superuser=True)
    with pytest.raises(Exception) as exc:
        await admin_module.update_quote(99999, AdminQuoteUpdateRequest(author="X"), db, user)
    assert exc.value.status_code == 404
