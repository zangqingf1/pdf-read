"""Regression tests for findings from the comprehensive code review."""

import uuid
from datetime import timedelta

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.v1 import pdf as pdf_module
from app.api.v1 import prompts as prompts_module
from app.api.v1 import sentences as sentences_module
from app.api.v1 import words as words_module
from app.auth import verification as verification_module
from app.auth.deps import get_current_user
from app.auth.security import create_access_token
from app.config import Settings, settings
from app.database import Base
from app.models.document import Document
from app.models.email_verification import EmailVerification
from app.models.sentence_analysis import SentenceAnalysis
from app.models.user import User
from app.models.word_analysis import WordAnalysis
from app.schemas.prompts import PromptTemplateUpdateRequest


@pytest_asyncio.fixture
async def db():
    test_engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session = async_sessionmaker(
        test_engine, class_=AsyncSession, expire_on_commit=False
    )()
    yield session
    await session.close()
    await test_engine.dispose()


async def _seed_user(db: AsyncSession, *, superuser: bool = False) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"{uuid.uuid4().hex}@example.com",
        nickname="reviewer",
        hashed_password="",
        is_active=True,
        is_superuser=superuser,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _seed_document(db: AsyncSession) -> Document:
    doc = Document(id=uuid.uuid4(), original_text="", parse_status="completed")
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return doc


# ── Critical: 验证码失败计数在路由异常后必须落库 ──────────────────


@pytest.mark.asyncio
async def test_verification_failed_attempt_persists_after_raise(db):
    email = "attempts@example.com"
    db.add(
        EmailVerification(
            email=email,
            purpose="register",
            code_hash=verification_module.hash_code("123456"),
            expires_at=verification_module._utcnow() + timedelta(minutes=10),
        )
    )
    await db.commit()

    with pytest.raises(Exception) as exc:
        await verification_module.consume_verification_code(
            db, email, "register", "000000"
        )
    assert exc.value.status_code == 400

    db.expire_all()
    row = (
        await db.execute(
            select(EmailVerification).where(EmailVerification.email == email)
        )
    ).scalar_one()
    assert row.failed_attempts == 1


async def _seed_code(db: AsyncSession, email: str, code: str = "123456") -> EmailVerification:
    row = EmailVerification(
        email=email,
        purpose="register",
        code_hash=verification_module.hash_code(code),
        expires_at=verification_module._utcnow() + timedelta(minutes=10),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@pytest.mark.asyncio
async def test_verification_failed_attempt_uses_db_side_increment(db, monkeypatch):
    """并发丢失更新回归：本会话持有陈旧计数时，不得把数据库中的真实计数覆盖回去。

    旧实现是 ``row.failed_attempts += 1``，会话里的陈旧快照会把并发请求已写入的
    计数覆盖掉，于是 5 次尝试上限可以被并发绕过（6 位码在 TTL 内可爆破）。
    新实现把自增放在 DB 侧，因此这里必须是 1 + 1 = 2。
    """
    monkeypatch.setattr(settings, "EMAIL_CODE_MAX_ATTEMPTS", 5)
    email = "lostupdate@example.com"
    row = await _seed_code(db, email)
    row_id = row.id

    # 模拟并发窗口：数据库里计数已是 1，而本会话身份映射里仍是 0
    await db.execute(
        update(EmailVerification)
        .where(EmailVerification.id == row_id)
        .values(failed_attempts=1)
        .execution_options(synchronize_session=False)
    )
    await db.commit()
    assert row.failed_attempts == 0, "前置条件：会话里必须是陈旧快照"

    with pytest.raises(HTTPException) as exc:
        await verification_module.consume_verification_code(db, email, "register", "000000")
    assert exc.value.status_code == 400

    db.expire_all()
    after = (
        await db.execute(
            select(EmailVerification).where(EmailVerification.id == row_id)
        )
    ).scalar_one()
    assert after.failed_attempts == 2, "陈旧快照覆盖了并发写入的计数（丢失更新）"


@pytest.mark.asyncio
async def test_verification_consume_is_single_winner(db, monkeypatch):
    """消费是带条件的原子 UPDATE：第二次必须拿到 0 行，正确验证码也随之被拒。"""
    monkeypatch.setattr(settings, "EMAIL_CODE_MAX_ATTEMPTS", 5)
    email = "singlewinner@example.com"
    row = await _seed_code(db, email)
    now = verification_module._utcnow()

    assert await verification_module._consume_row_atomically(db, row.id, now) == 1
    await db.commit()
    # 并发第二个请求：同一行再消费一次必须失败
    assert await verification_module._consume_row_atomically(db, row.id, verification_module._utcnow()) == 0
    await db.commit()

    with pytest.raises(HTTPException) as exc:
        await verification_module.consume_verification_code(db, email, "register", "123456")
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_verification_cap_rejects_correct_code(db, monkeypatch):
    """达到尝试上限后，正确验证码也失效（不能被“再试一次正确的”翻盘）。"""
    monkeypatch.setattr(settings, "EMAIL_CODE_MAX_ATTEMPTS", 2)
    email = "cap@example.com"
    await _seed_code(db, email)

    for _ in range(2):
        with pytest.raises(HTTPException) as exc:
            await verification_module.consume_verification_code(db, email, "register", "000000")
        assert exc.value.status_code == 400

    with pytest.raises(HTTPException) as exc:
        await verification_module.consume_verification_code(db, email, "register", "123456")
    assert exc.value.status_code == 400


# ── Critical/High: Prompt 写入必须是管理员 ─────────────────────────


@pytest.mark.asyncio
async def test_prompt_update_requires_superuser(db):
    user = await _seed_user(db)
    request = PromptTemplateUpdateRequest(user_prompt="自定义提示词")
    with pytest.raises(Exception) as exc:
        await prompts_module.update_prompt_template(
            "translate", request, db, user
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_prompt_update_allowed_for_superuser(db):
    user = await _seed_user(db, superuser=True)
    request = PromptTemplateUpdateRequest(user_prompt="管理员提示词")
    result = await prompts_module.update_prompt_template(
        "translate", request, db, user
    )
    assert result.user_prompt == "管理员提示词"


# ── Critical: 迁移 SQL 必须同时兼容 SQLite 与 PostgreSQL ──────────


@pytest.mark.asyncio
async def test_migrations_apply_on_fresh_sqlite(monkeypatch):
    test_engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    monkeypatch.setattr("app.database.engine", test_engine)
    try:
        from app import database

        await database.run_migrations()
        async with test_engine.begin() as conn:
            applied = (
                await conn.exec_driver_sql(
                    "SELECT name FROM _migrations "
                    "WHERE name = '004b_prompt_templates_copy_data'"
                )
            ).fetchall()
            assert applied, "004b 迁移应成功执行"
            tables = (
                await conn.exec_driver_sql(
                    "SELECT name FROM sqlite_master "
                    "WHERE type='table' AND name='prompt_templates'"
                )
            ).fetchall()
            assert tables, "004 迁移后 prompt_templates 表应存在"
    finally:
        await test_engine.dispose()


# ── High: JWT_SECRET_KEY 必须接受与 SECRET_KEY 相同的生产校验 ─────


def test_production_rejects_weak_jwt_secret_key():
    with pytest.raises(ValueError):
        Settings(
            ENVIRONMENT="production",
            SECRET_KEY="a-secure-random-value",
            JWT_SECRET_KEY="change-me-in-production",
            _env_file=None,
        )


# ── Medium: 密码重置后旧 JWT 必须失效 ─────────────────────────────


@pytest.mark.asyncio
async def test_old_token_rejected_after_token_version_bump(db):
    user = await _seed_user(db)
    old_token = create_access_token(data={"sub": str(user.id), "ver": 0})

    user.token_version = 1
    await db.commit()

    with pytest.raises(Exception) as exc:
        await get_current_user(token=old_token, db=db)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_legacy_token_without_ver_accepted_when_version_zero(db):
    user = await _seed_user(db)
    legacy_token = create_access_token(data={"sub": str(user.id)})

    current = await get_current_user(token=legacy_token, db=db)
    assert current.id == user.id


# ── Medium: 单词/句子解析 upsert 不再先查后插 ─────────────────────


@pytest.mark.asyncio
async def test_word_analysis_upsert_updates_without_duplicate(db):
    doc = await _seed_document(db)
    entry = {
        "paragraph_index": 0,
        "word": "gravity",
        "phonetic": "/a/",
        "part_of_speech": "n.",
        "definition": "old",
        "definition_zh": "旧释义",
        "collocations": [],
        "example_sentence": "",
        "cognates": [],
        "synonyms_antonyms": {"synonyms": []},
        "base_form": "",
        "plural_form": "",
    }
    await words_module._persist_analyses(str(doc.id), [entry], db)

    entry["definition"] = "new"
    entry["definition_zh"] = "新释义"
    await words_module._persist_analyses(str(doc.id), [entry], db)

    # 不能用 expire_all() + 惰性加载（async 会话会 MissingGreenlet）；
    # populate_existing 让 select 从 DB 重读以覆盖身份映射里的旧对象。
    rows = (
        await db.execute(
            select(WordAnalysis)
            .where(WordAnalysis.document_id == str(doc.id))
            .execution_options(populate_existing=True)
        )
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].definition == "new"
    assert rows[0].definition_zh == "新释义"


@pytest.mark.asyncio
async def test_sentence_analysis_upsert_updates_without_duplicate(db):
    doc = await _seed_document(db)
    entry = {
        "paragraph_index": 0,
        "sentence_index": 0,
        "sentence_text": "Hello world.",
        "content": "old",
    }
    await sentences_module._persist_analyses(str(doc.id), [entry], db)

    entry["content"] = "new"
    await sentences_module._persist_analyses(str(doc.id), [entry], db)

    rows = (
        await db.execute(
            select(SentenceAnalysis)
            .where(SentenceAnalysis.document_id == str(doc.id))
            .execution_options(populate_existing=True)
        )
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].structure_json == '{"content": "new"}'


# ── High: 段落删除/重排后 analysis 索引必须正确且无冲突 ──────────


@pytest.mark.asyncio
async def test_reshift_analysis_indices_delete(db):
    doc = await _seed_document(db)
    for idx, word in ((0, "a"), (1, "b"), (2, "c")):
        db.add(
            WordAnalysis(
                id=str(uuid.uuid4()),
                document_id=str(doc.id),
                paragraph_index=idx,
                word=word,
            )
        )
    await db.commit()

    await pdf_module._reshift_analysis_indices(db, doc.id, delete_at=1)
    await db.commit()

    rows = (
        await db.execute(
            select(WordAnalysis)
            .where(WordAnalysis.document_id == str(doc.id))
            .order_by(WordAnalysis.paragraph_index)
            .execution_options(populate_existing=True)
        )
    ).scalars().all()
    assert [r.paragraph_index for r in rows] == [0, 1]
    assert [r.word for r in rows] == ["a", "c"]


@pytest.mark.asyncio
async def test_reshift_analysis_indices_reorder_no_unique_conflict(db):
    doc = await _seed_document(db)
    for idx in (0, 1):
        db.add(
            WordAnalysis(
                id=str(uuid.uuid4()),
                document_id=str(doc.id),
                paragraph_index=idx,
                word="dup",
            )
        )
    await db.commit()

    await pdf_module._reshift_analysis_indices(
        db, doc.id, index_map={0: 1, 1: 0}
    )
    await db.commit()

    rows = (
        await db.execute(
            select(WordAnalysis)
            .where(WordAnalysis.document_id == str(doc.id))
            .order_by(WordAnalysis.paragraph_index)
            .execution_options(populate_existing=True)
        )
    ).scalars().all()
    assert len(rows) == 2
    assert [r.paragraph_index for r in rows] == [0, 1]
    assert {r.word for r in rows} == {"dup"}
