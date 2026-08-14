"""测试：邮箱验证码注册 / 登录 / 忘记密码 / 头像 / 个人资料。

全部离线：in-memory SQLite（StaticPool）+ 直接调用路由函数（与
test_summary.py 同一模式）。SMTP 未配置且 ENVIRONMENT=development 时
验证码走 console 兜底并随响应返回 ``dev_code``，测试据此取码。
"""

import io
import types
import uuid
from datetime import timedelta

import pydantic
import pytest
import pytest_asyncio
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool
from starlette.datastructures import UploadFile

from app.auth import rate_limit as rate_limit_module
from app.auth import router as auth_router
from app.auth import verification as verification_module
from app.auth.schemas import (
    LoginRequest,
    ProfileUpdateRequest,
    RegisterRequest,
    ResetPasswordConfirmRequest,
    SendCodeRequest,
)
from app.auth.security import hash_password, verify_password
from app.auth.verification import consume_verification_code, hash_code, verify_code
from app.config import settings
from app.database import Base
from app.models.email_verification import EmailVerification
from app.models.user import User

FAKE_IP = "127.0.0.1"
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


def fake_request():
    return types.SimpleNamespace(client=types.SimpleNamespace(host=FAKE_IP))


# ── Fixtures ─────────────────────────────────────────────────────────


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )()
    yield session
    await session.close()
    await engine.dispose()


@pytest.fixture(autouse=True)
def _clear_limits_and_dev_mode(monkeypatch):
    """每次测试前清空进程内限流状态，并强制开发模式 + 无 SMTP（console 兜底）。"""
    rate_limit_module._failures.clear()
    verification_module._ip_send_log.clear()
    monkeypatch.setattr(settings, "ENVIRONMENT", "development")
    monkeypatch.setattr(settings, "SMTP_HOST", "")
    monkeypatch.setattr(settings, "SMTP_USER", "")


async def _seed_user(db: AsyncSession, email: str, password: str = "SeedPass123") -> User:
    user = User(
        id=uuid.uuid4(),
        email=email,
        nickname=email.split("@")[0],
        hashed_password=hash_password(password),
        is_active=True,
        is_verified=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _send_and_get_code(db: AsyncSession, email: str, purpose: str) -> str:
    resp = await auth_router.send_verification_code_endpoint(
        SendCodeRequest(email=email, purpose=purpose), fake_request(), db
    )
    return resp["dev_code"]


def _register_body(email: str, code: str, **overrides) -> RegisterRequest:
    data = dict(
        email=email,
        password="StrongPass1",
        password_confirm="StrongPass1",
        verification_code=code,
        nickname="测试用户",
    )
    data.update(overrides)
    return RegisterRequest(**data)


# ── 验证码：哈希与常量时间比较 ──────────────────────────────────────


def test_code_hash_roundtrip():
    code = "123456"
    digest = hash_code(code)
    assert verify_code(code, digest) is True
    assert verify_code("654321", digest) is False
    assert "123456" not in digest  # 绝不存明文


# ── 验证码发送 ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_send_code_returns_dev_code_and_stores_hash_only(db):
    resp = await auth_router.send_verification_code_endpoint(
        SendCodeRequest(email="alice@example.com", purpose="register"),
        fake_request(),
        db,
    )
    assert resp["message"]
    code = resp["dev_code"]
    assert code.isdigit() and len(code) == settings.EMAIL_CODE_LENGTH

    row = (
        await db.execute(
            select(EmailVerification).where(EmailVerification.email == "alice@example.com")
        )
    ).scalar_one()
    assert row.code_hash == hash_code(code)
    assert row.code_hash != code
    assert row.consumed_at is None


@pytest.mark.asyncio
async def test_send_code_cooldown_429(db):
    email = "bob@example.com"
    await _send_and_get_code(db, email, "register")
    with pytest.raises(Exception) as exc:
        await auth_router.send_verification_code_endpoint(
            SendCodeRequest(email=email, purpose="register"), fake_request(), db
        )
    assert exc.value.status_code == 429


@pytest.mark.asyncio
async def test_send_code_hourly_limit_429(db, monkeypatch):
    monkeypatch.setattr(settings, "EMAIL_SEND_COOLDOWN_SECONDS", 0)
    monkeypatch.setattr(settings, "EMAIL_MAX_PER_HOUR", 2)
    email = "carol@example.com"
    await _send_and_get_code(db, email, "register")
    await _send_and_get_code(db, email, "register")
    with pytest.raises(Exception) as exc:
        await _send_and_get_code(db, email, "register")
    assert exc.value.status_code == 429


@pytest.mark.asyncio
async def test_send_code_register_duplicate_email_409(db):
    await _seed_user(db, "dave@example.com")
    with pytest.raises(Exception) as exc:
        await auth_router.send_verification_code_endpoint(
            SendCodeRequest(email="dave@example.com", purpose="register"),
            fake_request(),
            db,
        )
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_send_code_reset_unknown_email_does_not_enumerate(db):
    """忘记密码：未知邮箱也返回成功，不泄露账号是否存在。"""
    resp = await auth_router.send_password_reset_code(
        SendCodeRequest(email="ghost@example.com", purpose="reset_password"),
        fake_request(),
        db,
    )
    assert "dev_code" in resp


@pytest.mark.asyncio
async def test_send_code_invalid_purpose_422(db):
    with pytest.raises(Exception) as exc:
        await auth_router.send_verification_code_endpoint(
            SendCodeRequest(email="x@example.com", purpose="banana"),
            fake_request(),
            db,
        )
    assert exc.value.status_code == 422


# ── 注册 ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_register_success(db):
    email = "eve@example.com"
    code = await _send_and_get_code(db, email, "register")
    resp = await auth_router.register(_register_body(email, code), db)
    await db.commit()

    assert resp.access_token
    assert resp.email == email
    assert resp.nickname == "测试用户"

    user = (
        await db.execute(select(User).where(User.email == email))
    ).scalar_one()
    assert user.is_verified is True
    assert user.nickname == "测试用户"
    assert verify_password("StrongPass1", user.hashed_password)


@pytest.mark.asyncio
async def test_register_without_code_422(db):
    """空验证码在 schema 层即被拒绝（等价 422）。"""
    email = "frank@example.com"
    with pytest.raises(pydantic.ValidationError):
        _register_body(email, "")


@pytest.mark.asyncio
async def test_register_wrong_code_400(db):
    email = "grace@example.com"
    await _send_and_get_code(db, email, "register")
    with pytest.raises(Exception) as exc:
        await auth_router.register(_register_body(email, "000000"), db)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_register_expired_code_400(db):
    email = "heidi@example.com"
    code = await _send_and_get_code(db, email, "register")
    await db.execute(
        update(EmailVerification)
        .where(EmailVerification.email == email)
        .values(expires_at=verification_module._utcnow() - timedelta(minutes=1))
    )
    await db.commit()
    with pytest.raises(Exception) as exc:
        await auth_router.register(_register_body(email, code), db)
    assert exc.value.status_code == 400
    assert "过期" in exc.value.detail


@pytest.mark.asyncio
async def test_register_code_single_use(db):
    """验证码消费一次后立即失效，不可复用。"""
    email = "ivan@example.com"
    code = await _send_and_get_code(db, email, "register")
    await auth_router.register(_register_body(email, code), db)
    await db.commit()

    # 同一验证码再次消费 → 400（直接调用 consume 验证单次使用语义）
    with pytest.raises(Exception) as exc:
        await consume_verification_code(db, email, "register", code)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_register_exhausted_attempts_invalidate_code(db, monkeypatch):
    monkeypatch.setattr(settings, "EMAIL_CODE_MAX_ATTEMPTS", 2)
    email = "judy@example.com"
    code = await _send_and_get_code(db, email, "register")
    for _ in range(2):
        with pytest.raises(Exception) as exc:
            await auth_router.register(_register_body(email, "000000"), db)
        assert exc.value.status_code == 400
    # 达到上限后，即使正确验证码也失效
    with pytest.raises(Exception) as exc:
        await auth_router.register(_register_body(email, code), db)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_register_weak_password_422(db):
    email = "kate@example.com"
    code = await _send_and_get_code(db, email, "register")
    with pytest.raises(Exception) as exc:
        await auth_router.register(_register_body(email, code, password="abcdefgh", password_confirm="abcdefgh"), db)
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_register_password_mismatch_422(db):
    email = "liam@example.com"
    code = await _send_and_get_code(db, email, "register")
    with pytest.raises(Exception) as exc:
        await auth_router.register(
            _register_body(email, code, password="StrongPass1", password_confirm="StrongPass2"), db
        )
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_register_duplicate_email_409(db):
    """已注册邮箱再注册 → 409（先于验证码校验）。"""
    await _seed_user(db, "mallory@example.com")
    # 发送端点会对已注册邮箱直接 409，因此绕过发送、直接写入一条有效验证码
    row = EmailVerification(
        email="mallory@example.com",
        purpose="register",
        code_hash=hash_code("123456"),
        expires_at=verification_module._utcnow() + timedelta(minutes=10),
    )
    db.add(row)
    await db.commit()
    with pytest.raises(Exception) as exc:
        await auth_router.register(_register_body("mallory@example.com", "123456"), db)
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_register_nickname_control_chars_422(db):
    email = "nick@example.com"
    code = await _send_and_get_code(db, email, "register")
    with pytest.raises(Exception) as exc:
        await auth_router.register(_register_body(email, code, nickname="bad\x00name"), db)
    assert exc.value.status_code == 422


# ── 登录（含限流）────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_login_success(db):
    await _seed_user(db, "oscar@example.com", "LoginPass1")
    resp = await auth_router.login(
        LoginRequest(email="oscar@example.com", password="LoginPass1"), fake_request(), db
    )
    assert resp.access_token
    assert resp.email == "oscar@example.com"


@pytest.mark.asyncio
async def test_login_wrong_password_401(db):
    await _seed_user(db, "pat@example.com", "LoginPass1")
    with pytest.raises(Exception) as exc:
        await auth_router.login(
            LoginRequest(email="pat@example.com", password="WrongPass1"), fake_request(), db
        )
    assert exc.value.status_code == 401
    assert "邮箱或密码错误" in exc.value.detail  # 通用文案防枚举


@pytest.mark.asyncio
async def test_login_unknown_email_401(db):
    with pytest.raises(Exception) as exc:
        await auth_router.login(
            LoginRequest(email="nobody@example.com", password="Whatever1"), fake_request(), db
        )
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_login_throttled_after_many_failures(db, monkeypatch):
    monkeypatch.setattr(settings, "LOGIN_MAX_ATTEMPTS", 3)
    monkeypatch.setattr(settings, "LOGIN_ATTEMPT_WINDOW_MINUTES", 15)
    await _seed_user(db, "quentin@example.com", "LoginPass1")

    for _ in range(3):
        with pytest.raises(Exception) as exc:
            await auth_router.login(
                LoginRequest(email="quentin@example.com", password="WrongPass1"),
                fake_request(),
                db,
            )
        assert exc.value.status_code == 401

    # 第 4 次（即使密码正确）也被限流
    with pytest.raises(Exception) as exc:
        await auth_router.login(
            LoginRequest(email="quentin@example.com", password="LoginPass1"),
            fake_request(),
            db,
        )
    assert exc.value.status_code == 429


@pytest.mark.asyncio
async def test_login_success_clears_failure_counter(db, monkeypatch):
    monkeypatch.setattr(settings, "LOGIN_MAX_ATTEMPTS", 3)
    await _seed_user(db, "rose@example.com", "LoginPass1")
    for _ in range(2):
        with pytest.raises(Exception):
            await auth_router.login(
                LoginRequest(email="rose@example.com", password="WrongPass1"),
                fake_request(),
                db,
            )
    resp = await auth_router.login(
        LoginRequest(email="rose@example.com", password="LoginPass1"), fake_request(), db
    )
    assert resp.access_token
    # 成功后计数清零 → 再错一次不触发限流
    with pytest.raises(Exception) as exc:
        await auth_router.login(
            LoginRequest(email="rose@example.com", password="WrongPass1"),
            fake_request(),
            db,
        )
    assert exc.value.status_code == 401


# ── 忘记密码 ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_password_reset_flow(db):
    email = "steve@example.com"
    await _seed_user(db, email, "OldPass123")

    code = await _send_and_get_code(db, email, "reset_password")

    resp = await auth_router.reset_password_confirm(
        ResetPasswordConfirmRequest(
            email=email,
            code=code,
            new_password="NewPass456",
            password_confirm="NewPass456",
        ),
        db,
    )
    await db.commit()
    assert "重置" in resp["message"]

    # 新密码可登录，旧密码失效
    new_login = await auth_router.login(
        LoginRequest(email=email, password="NewPass456"), fake_request(), db
    )
    assert new_login.access_token
    with pytest.raises(Exception) as exc:
        await auth_router.login(
            LoginRequest(email=email, password="OldPass123"), fake_request(), db
        )
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_password_reset_wrong_code_400(db):
    email = "trudy@example.com"
    await _seed_user(db, email)
    await _send_and_get_code(db, email, "reset_password")
    with pytest.raises(Exception) as exc:
        await auth_router.reset_password_confirm(
            ResetPasswordConfirmRequest(
                email=email, code="000000", new_password="NewPass456", password_confirm="NewPass456"
            ),
            db,
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_password_reset_unknown_email_400(db):
    with pytest.raises(Exception) as exc:
        await auth_router.reset_password_confirm(
            ResetPasswordConfirmRequest(
                email="ghost@example.com",
                code="123456",
                new_password="NewPass456",
                password_confirm="NewPass456",
            ),
            db,
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_password_reset_code_single_use(db):
    email = "victor@example.com"
    await _seed_user(db, email)
    code = await _send_and_get_code(db, email, "reset_password")
    body = ResetPasswordConfirmRequest(
        email=email, code=code, new_password="NewPass456", password_confirm="NewPass456"
    )
    await auth_router.reset_password_confirm(body, db)
    await db.commit()
    with pytest.raises(Exception) as exc:
        await auth_router.reset_password_confirm(body, db)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_password_reset_weak_new_password_422(db):
    email = "wendy@example.com"
    await _seed_user(db, email)
    code = await _send_and_get_code(db, email, "reset_password")
    with pytest.raises(Exception) as exc:
        await auth_router.reset_password_confirm(
            ResetPasswordConfirmRequest(
                email=email, code=code, new_password="weakpass", password_confirm="weakpass"
            ),
            db,
        )
    assert exc.value.status_code == 422


# ── 头像 ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_avatar_upload_and_get(db, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path))
    user = await _seed_user(db, "xenia@example.com")

    resp = await auth_router.upload_avatar(
        UploadFile(file=io.BytesIO(PNG_BYTES), filename="me.png"), user, db
    )
    await db.commit()
    assert resp.avatar_url and resp.avatar_url.startswith("avatars/")
    assert (tmp_path / resp.avatar_url).read_bytes() == PNG_BYTES

    file_resp = await auth_router.get_avatar(str(user.id), db)
    assert file_resp.path is not None
    assert file_resp.media_type == "image/png"

    # /me 返回 avatar_url
    me = await auth_router.get_me(user)
    assert me.avatar_url == resp.avatar_url


@pytest.mark.asyncio
async def test_avatar_rejects_non_image(db, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path))
    user = await _seed_user(db, "yolanda@example.com")
    with pytest.raises(Exception) as exc:
        await auth_router.upload_avatar(
            UploadFile(file=io.BytesIO(b"this is not an image"), filename="evil.png"),
            user,
            db,
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_avatar_rejects_oversized(db, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path))
    monkeypatch.setattr(settings, "AVATAR_MAX_MB", 0)
    user = await _seed_user(db, "zoe@example.com")
    with pytest.raises(Exception) as exc:
        await auth_router.upload_avatar(
            UploadFile(file=io.BytesIO(PNG_BYTES), filename="big.png"), user, db
        )
    assert exc.value.status_code == 413


@pytest.mark.asyncio
async def test_avatar_remove(db, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path))
    user = await _seed_user(db, "amy@example.com")
    resp = await auth_router.upload_avatar(
        UploadFile(file=io.BytesIO(PNG_BYTES), filename="me.png"), user, db
    )
    await db.commit()
    avatar_path = tmp_path / resp.avatar_url
    assert avatar_path.exists()

    await auth_router.remove_avatar(user, db)
    await db.commit()
    assert user.avatar_url is None
    assert not avatar_path.exists()


@pytest.mark.asyncio
async def test_avatar_get_missing_user_404(db):
    with pytest.raises(Exception) as exc:
        await auth_router.get_avatar(str(uuid.uuid4()), db)
    assert exc.value.status_code == 404


# ── 个人资料 ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_update_profile_nickname(db):
    user = await _seed_user(db, "betty@example.com")
    resp = await auth_router.update_profile(
        ProfileUpdateRequest(nickname="新昵称"), user
    )
    await db.commit()
    assert resp.nickname == "新昵称"
    assert user.nickname == "新昵称"


@pytest.mark.asyncio
async def test_update_profile_nickname_control_chars_422(db):
    user = await _seed_user(db, "cathy@example.com")
    with pytest.raises(Exception) as exc:
        await auth_router.update_profile(
            ProfileUpdateRequest(nickname="bad\x01name"), user
        )
    assert exc.value.status_code == 422
