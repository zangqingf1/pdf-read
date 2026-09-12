"""测试：问题反馈 — 提交/校验/截图落盘/列表/管理员处理。

全部离线：in-memory SQLite（StaticPool）+ 直接调用路由函数（不跑 HTTP 层）。
"""

import base64
import json
import uuid
from io import BytesIO
from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.v1 import admin as admin_module
from app.api.v1 import feedback as feedback_module
from app.config import settings
from app.database import Base
from app.models.feedback import Feedback
from app.models.user import User
from app.schemas.feedback import AdminFeedbackUpdateRequest

pytestmark = pytest.mark.asyncio

# 1x1 透明 PNG —— 能被 PIL 解码，用于验证截图链路
PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8"
    "BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
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


@pytest_asyncio.fixture(autouse=True)
async def upload_dir(tmp_path, monkeypatch):
    """把截图写到临时目录，避免污染真实 uploads/。"""
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path))
    return tmp_path


async def _seed_user(db: AsyncSession, *, superuser: bool = False) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"{uuid.uuid4().hex}@example.com",
        nickname="tester",
        hashed_password="",
        is_active=True,
        is_superuser=superuser,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


def _upload(data: bytes, filename: str = "shot.png") -> UploadFile:
    return UploadFile(file=BytesIO(data), filename=filename)


async def _submit(db: AsyncSession, user: User, **overrides):
    kwargs = {
        "category": "bug",
        "content": "页面打不开",
        "contact": None,
        "images": None,
    }
    kwargs.update(overrides)
    return await feedback_module.create_feedback(
        db=db, current_user=user, _rate_limit=None, **kwargs
    )


# ── 提交 ──────────────────────────────────────────────────────────


async def test_create_feedback_trims_and_defaults(db):
    user = await _seed_user(db)
    item = await _submit(
        db, user, content="  页面打不开  ", contact=" me@example.com "
    )
    assert item.content == "页面打不开"
    assert item.contact == "me@example.com"
    assert item.category == "bug"
    assert item.status == "pending"
    assert item.image_count == 0
    assert item.admin_reply is None


async def test_create_rejects_invalid_category(db):
    user = await _seed_user(db)
    with pytest.raises(HTTPException) as exc:
        await _submit(db, user, category="nope")
    assert exc.value.status_code == 400
    assert (await db.execute(select(func.count(Feedback.id)))).scalar() == 0


async def test_create_rejects_blank_content(db):
    user = await _seed_user(db)
    with pytest.raises(HTTPException) as exc:
        await _submit(db, user, content="   ")
    assert exc.value.status_code == 400
    assert (await db.execute(select(func.count(Feedback.id)))).scalar() == 0


# ── 截图 ──────────────────────────────────────────────────────────


async def test_create_rejects_non_image(db):
    user = await _seed_user(db)
    with pytest.raises(HTTPException) as exc:
        await _submit(db, user, images=[_upload(b"definitely not an image")])
    assert exc.value.status_code == 400
    # 校验失败不得留下行或文件
    assert (await db.execute(select(func.count(Feedback.id)))).scalar() == 0


async def test_create_rejects_oversize_image(db, monkeypatch):
    monkeypatch.setattr(settings, "FEEDBACK_MAX_MB", 0)
    user = await _seed_user(db)
    with pytest.raises(HTTPException) as exc:
        await _submit(db, user, images=[_upload(PNG_1PX)])
    assert exc.value.status_code == 413


async def test_create_rejects_too_many_images(db, upload_dir):
    """超过 FEEDBACK_MAX_IMAGES 张直接拒绝，且磁盘上不留任何文件。"""
    user = await _seed_user(db)
    too_many = [_upload(PNG_1PX, f"s{i}.png") for i in range(settings.FEEDBACK_MAX_IMAGES + 1)]
    with pytest.raises(HTTPException) as exc:
        await _submit(db, user, images=too_many)
    assert exc.value.status_code == 400
    assert (await db.execute(select(func.count(Feedback.id)))).scalar() == 0
    assert list(upload_dir.glob("feedback/*")) == []


async def test_create_rejects_oversize_total(db, upload_dir, monkeypatch):
    """单张都不超限但总量超限同样拒绝（校验在写盘前完成）。"""
    monkeypatch.setattr(settings, "FEEDBACK_MAX_MB", 5)
    monkeypatch.setattr(settings, "FEEDBACK_MAX_TOTAL_MB", 0)
    user = await _seed_user(db)
    with pytest.raises(HTTPException) as exc:
        await _submit(db, user, images=[_upload(PNG_1PX), _upload(PNG_1PX, "s2.png")])
    assert exc.value.status_code == 413
    assert list(upload_dir.glob("feedback/*")) == []


async def test_create_with_images_persists_all_and_delete_cleans_files(db, upload_dir):
    owner = await _seed_user(db)
    admin = await _seed_user(db, superuser=True)
    item = await _submit(
        db,
        owner,
        images=[_upload(PNG_1PX, f"s{i}.png") for i in range(3)],
    )
    assert item.image_count == 3

    fb = await db.get(Feedback, item.id)
    saved = [Path(settings.UPLOAD_DIR) / p for p in json.loads(fb.image_paths)]
    assert len(saved) == 3
    assert all(p.is_file() for p in saved)

    await admin_module.delete_feedback(feedback_id=item.id, db=db, admin=admin)
    assert await db.get(Feedback, item.id) is None
    assert not any(p.is_file() for p in saved)


async def test_image_endpoint_serves_each_index(db, upload_dir):
    owner = await _seed_user(db)
    item = await _submit(
        db, owner, images=[_upload(PNG_1PX, "a.png"), _upload(PNG_1PX, "b.png")]
    )

    for index in (0, 1):
        resp = await feedback_module.get_feedback_image(
            feedback_id=item.id, index=index, db=db, current_user=owner
        )
        assert resp.status_code == 200

    # 越界索引 → 404
    with pytest.raises(HTTPException) as exc:
        await feedback_module.get_feedback_image(
            feedback_id=item.id, index=2, db=db, current_user=owner
        )
    assert exc.value.status_code == 404


async def test_image_endpoint_requires_owner_or_admin(db):
    owner = await _seed_user(db)
    other = await _seed_user(db)
    admin = await _seed_user(db, superuser=True)
    item = await _submit(db, owner, images=[_upload(PNG_1PX)])

    # 提交者本人可取
    resp = await feedback_module.get_feedback_image(
        feedback_id=item.id, index=0, db=db, current_user=owner
    )
    assert resp.status_code == 200

    # 其他普通用户 → 404（不泄露存在性）
    with pytest.raises(HTTPException) as exc:
        await feedback_module.get_feedback_image(
            feedback_id=item.id, index=0, db=db, current_user=other
        )
    assert exc.value.status_code == 404

    # 管理员可取
    resp = await feedback_module.get_feedback_image(
        feedback_id=item.id, index=0, db=db, current_user=admin
    )
    assert resp.status_code == 200


async def test_image_endpoint_404_when_row_missing(db):
    user = await _seed_user(db)
    with pytest.raises(HTTPException) as exc:
        await feedback_module.get_feedback_image(
            feedback_id=9999, index=0, db=db, current_user=user
        )
    assert exc.value.status_code == 404


# ── 我的反馈列表 ────────────────────────────────────────────────────


async def test_list_mine_is_newest_first_and_scoped(db):
    user = await _seed_user(db)
    other = await _seed_user(db)
    for i in range(3):
        await _submit(db, user, content=f"f{i}")
    await _submit(db, other, content="别人的反馈")

    first = await feedback_module.list_my_feedback(
        limit=2, offset=0, db=db, current_user=user
    )
    assert first.total == 3
    assert [f.content for f in first.feedbacks] == ["f2", "f1"]

    second = await feedback_module.list_my_feedback(
        limit=2, offset=2, db=db, current_user=user
    )
    assert [f.content for f in second.feedbacks] == ["f0"]


# ── 管理后台 ──────────────────────────────────────────────────────


async def test_admin_list_includes_submitter_and_filters(db):
    owner = await _seed_user(db)
    admin = await _seed_user(db, superuser=True)
    await _submit(db, owner, category="bug", content="导出报错")
    await _submit(db, owner, category="feature", content="想要夜间模式")

    all_rows = await admin_module.list_feedback(
        search="", status_filter=None, limit=20, offset=0, db=db, admin=admin
    )
    assert all_rows.total == 2
    assert all_rows.feedbacks[0].user_email == owner.email

    searched = await admin_module.list_feedback(
        search="夜间", status_filter=None, limit=20, offset=0, db=db, admin=admin
    )
    assert searched.total == 1
    assert searched.feedbacks[0].category == "feature"

    pending = await admin_module.list_feedback(
        search="", status_filter="pending", limit=20, offset=0, db=db, admin=admin
    )
    assert pending.total == 2


async def test_admin_list_rejects_invalid_status_filter(db):
    admin = await _seed_user(db, superuser=True)
    with pytest.raises(HTTPException) as exc:
        await admin_module.list_feedback(
            search="", status_filter="bogus", limit=20, offset=0, db=db, admin=admin
        )
    assert exc.value.status_code == 400


async def test_admin_update_status_and_reply(db):
    owner = await _seed_user(db)
    admin = await _seed_user(db, superuser=True)
    item = await _submit(db, owner)

    updated = await admin_module.update_feedback(
        feedback_id=item.id,
        body=AdminFeedbackUpdateRequest(status="resolved", admin_reply=" 已修复 "),
        db=db,
        admin=admin,
    )
    assert updated.status == "resolved"
    assert updated.admin_reply == "已修复"
    assert updated.replied_at is not None

    # 提交者在自己的列表里能看到状态与回复
    mine = await feedback_module.list_my_feedback(
        limit=20, offset=0, db=db, current_user=owner
    )
    assert mine.feedbacks[0].status == "resolved"
    assert mine.feedbacks[0].admin_reply == "已修复"

    # 清空回复 → 回复时间一并清空
    cleared = await admin_module.update_feedback(
        feedback_id=item.id,
        body=AdminFeedbackUpdateRequest(admin_reply=""),
        db=db,
        admin=admin,
    )
    assert cleared.admin_reply is None
    assert cleared.replied_at is None


async def test_admin_update_missing_row_404(db):
    admin = await _seed_user(db, superuser=True)
    with pytest.raises(HTTPException) as exc:
        await admin_module.update_feedback(
            feedback_id=9999,
            body=AdminFeedbackUpdateRequest(status="processing"),
            db=db,
            admin=admin,
        )
    assert exc.value.status_code == 404
