"""回归测试：段落翻译两个 bug 的修复。

Bug 1 — 第一段翻译连同第二段：
  - 根因是持久化按提交位置写索引（子集 [14,15] 被写进 0/1）。
  修复：请求携带真实段落索引 ``indices``，``_save_translations`` 按真实索引
  写库；Prompt 增加"只翻译标记区间、片段不合并下文"的约束。

Bug 2 — 个别段落不翻译：
  - ``translate()`` 未禁用 thinking，reasoning 吃光 max_tokens 后返回空
    content（不抛异常）；空内容现在按可重试失败处理（RuntimeError）。
  修复后这些测试全部通过。
"""

import asyncio
import uuid
from typing import Any

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.v1 import translate as translate_module
from app.api.v1.translate import (
    _map_positions_to_indices,
    _persist_translations_by_index,
    _save_translations,
)
from app.database import Base
from app.models.document import Document
from app.models.paragraph import Paragraph
from app.models.user import User
from app.schemas.translate import TranslateRequest
from app.services.ai_service import AIService


class FakeJsonResponse:
    """模拟非流式响应（raise_for_status + json）。"""

    def __init__(self, status: int = 200, data: dict | None = None):
        self.status = status
        self._data = data or {}

    def raise_for_status(self):
        if self.status >= 400:
            req = httpx.Request("POST", "https://fake/v1/chat/completions")
            raise httpx.HTTPStatusError(
                f"HTTP {self.status}",
                request=req,
                response=httpx.Response(self.status, request=req),
            )

    def json(self):
        return self._data


class FakeClient:
    """按顺序返回预设响应的假 httpx client，记录每次请求的 payload。"""

    def __init__(self, responses: list):
        self._responses = list(responses)
        self._i = 0
        self.payloads: list[dict] = []

    async def post(self, url, json=None):
        if json:
            self.payloads.append(json)
        resp = self._responses[min(self._i, len(self._responses) - 1)]
        self._i += 1
        return resp


def _make_service(fake: FakeClient) -> AIService:
    ai = AIService(api_key="test-key", base_url="https://fake/v1")
    ai._client = fake  # type: ignore[attr-defined]
    return ai


def _content_response(text: str) -> FakeJsonResponse:
    return FakeJsonResponse(data={"choices": [{"message": {"content": text}}]})


async def _no_sleep(_: float) -> None:
    return None


# ── Fix B: translate() 禁用 thinking + 空内容重试 ────────────────────


@pytest.mark.asyncio
async def test_translate_request_disables_thinking_and_budget():
    """翻译请求应禁用 thinking，且 max_tokens 有 8192 上限（非 4096）。"""
    fake = FakeClient([_content_response("中文翻译")])
    ai = _make_service(fake)

    result = await ai.translate("Hello world")

    assert result == "中文翻译"
    assert fake.payloads, "应发出过 AI 请求"
    payload = fake.payloads[0]
    assert payload.get("thinking") == {"type": "disabled"}, (
        f"应禁用 thinking, 实际 {payload.get('thinking')}"
    )
    assert payload["max_tokens"] <= 8192, (
        f"max_tokens 上限应 ≤ 8192, 实际 {payload['max_tokens']}"
    )


@pytest.mark.asyncio
async def test_translate_retries_empty_content_then_succeeds(monkeypatch):
    """空 content（thinking 吃光预算）应作为可重试失败，3 次后返回真实结果。"""
    monkeypatch.setattr(asyncio, "sleep", _no_sleep)
    fake = FakeClient(
        [
            _content_response("   "),  # attempt 1: 空
            _content_response("\n\t"),  # attempt 2: 空白
            _content_response("终于成功"),  # attempt 3: 成功
        ]
    )
    ai = _make_service(fake)

    result = await ai.translate("Some long English paragraph")

    assert result == "终于成功"
    assert len(fake.payloads) == 3, f"应重试 3 次, 实际 {len(fake.payloads)}"


@pytest.mark.asyncio
async def test_translate_raises_runtime_error_after_all_empty(monkeypatch):
    """连续 3 次空 content → 抛 RuntimeError（非 ValueError）。"""
    monkeypatch.setattr(asyncio, "sleep", _no_sleep)
    fake = FakeClient([_content_response("")] * 3)
    ai = _make_service(fake)

    with pytest.raises(RuntimeError):
        await ai.translate("Paragraph")

    assert len(fake.payloads) == 3


# ── Fix A: 位置 → 真实索引映射 ───────────────────────────────────────


def test_map_positions_to_indices_uses_request_indices():
    """有 indices 时返回它本身（位置对齐真实索引）。"""

    class _Req:
        indices = [14, 15]

    assert _map_positions_to_indices(_Req(), 2) == [14, 15]


def test_map_positions_to_indices_falls_back_to_positions():
    """无 indices 时回退为位置即索引（旧行为）。"""

    class _Req:
        indices = None

    assert _map_positions_to_indices(_Req(), 3) == [0, 1, 2]


# ── Fix A: _save_translations 按真实索引写库 ─────────────────────────


async def _make_db() -> tuple[Any, AsyncSession]:
    """创建内存 SQLite 引擎 + session（StaticPool 使单连接跨 session 可见）。"""
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)()
    return engine, session


async def _seed_doc(db: AsyncSession, count: int = 4) -> uuid.UUID:
    doc_id = uuid.uuid4()
    db.add(Document(id=doc_id, original_text="", parse_status="completed"))
    for i in range(count):
        db.add(Paragraph(document_id=doc_id, index=i, text_en=f"en{i}"))
    await db.commit()
    return doc_id


@pytest.mark.asyncio
async def test_save_translations_keyed_by_real_index():
    """只更新请求中的真实索引，其余段落不动；不存在的索引静默跳过。"""
    engine, db = await _make_db()
    try:
        doc_id = await _seed_doc(db)

        await _save_translations(str(doc_id), {3: "zh3", 1: "zh1"}, db)
        # 空白文本被跳过
        await _save_translations(str(doc_id), {0: "   ", 99: "nope"}, db)

        db.expire_all()
        result = await db.execute(
            select(Paragraph).where(Paragraph.document_id == doc_id).order_by(Paragraph.index)
        )
        paras = result.scalars().all()
        assert paras[1].text_zh == "zh1", "索引 1 应写入 zh1"
        assert paras[3].text_zh == "zh3", "索引 3 应写入 zh3"
        assert paras[0].text_zh is None, "索引 0 收到空白文本，不应写入"
        assert paras[2].text_zh is None, "索引 2 未在请求中，不应写入"
    finally:
        await db.close()
        await engine.dispose()


@pytest.mark.asyncio
async def test_persist_translations_by_index_subset_maps_positions():
    """前端只提交子集时，位置 0/1 应对应真实索引 14/15，而非段落 0/1。"""
    engine, db = await _make_db()
    try:
        doc_id = uuid.uuid4()
        db.add(Document(id=doc_id, original_text="", parse_status="completed"))
        # 模拟真实文档：19 段，只翻译 14/15 两个非连续段
        for i in range(19):
            db.add(Paragraph(document_id=doc_id, index=i, text_en=f"en{i}"))
        await db.commit()

        # 提交位置 [0,1] → 真实索引 [14,15]
        await _persist_translations_by_index(
            str(doc_id),
            [(0, "泽连斯基改组内阁"), (1, "斯维里登科辞职")],
            [14, 15],
            db,
        )

        db.expire_all()
        result = await db.execute(
            select(Paragraph).where(Paragraph.document_id == doc_id).order_by(Paragraph.index)
        )
        paras = result.scalars().all()
        assert paras[14].text_zh == "泽连斯基改组内阁", "14 段应写入自己的翻译"
        assert paras[15].text_zh == "斯维里登科辞职", "15 段应写入自己的翻译"
        assert paras[0].text_zh is None, "第 0 段不应被污染"
        assert paras[1].text_zh is None, "第 1 段不应被污染"
    finally:
        await db.close()
        await engine.dispose()


# ── 端点级接线：translate_stream 子集 + indices 持久化 ───────────────


class _StubAI:
    """最小 AIService 替身：记录收到的段落，按位置返回确定性翻译。"""

    def __init__(self):
        self.calls: list[list[str]] = []

    async def translate_batch_stream(self, paragraphs, **kwargs):
        self.calls.append(list(paragraphs))
        for i, _p in enumerate(paragraphs):
            yield (i, f"翻译-位置{i}")


async def _seed_user_doc(db: AsyncSession, count: int = 19) -> tuple[uuid.UUID, uuid.UUID]:
    user = User(id=uuid.uuid4(), email=f"u{uuid.uuid4().hex}@t.com")
    doc = Document(
        id=uuid.uuid4(), original_text="", parse_status="completed", user_id=user.id
    )
    db.add_all([user, doc])
    for i in range(count):
        db.add(Paragraph(document_id=doc.id, index=i, text_en=f"en{i}"))
    await db.commit()
    return user.id, doc.id


@pytest.mark.asyncio
async def test_stream_endpoint_persists_subset_by_real_index(monkeypatch):
    """POST /translate/stream 完整接线：提交子集 [14,15] + indices，
    持久化落在真实索引 14/15，段落 0/1 不被污染。"""
    engine, db = await _make_db()
    try:
        user_id, doc_id = await _seed_user_doc(db)
        user = (await db.execute(select(User).where(User.id == user_id))).scalar_one()

        stub = _StubAI()
        monkeypatch.setattr(translate_module, "create_ai_service", lambda *a, **k: stub)

        request = TranslateRequest(
            paragraphs=["en14", "en15"],
            indices=[14, 15],
            document_id=str(doc_id),
        )
        resp = await translate_module.translate_stream(request, db, user)

        chunks: list[str] = []
        async for chunk in resp.body_iterator:
            chunks.append(chunk)
        body = "".join(chunks)
        events = [
            line for line in body.split("\n") if line.startswith("data: ")
        ]
        # 2 个翻译事件 + 1 个 done 事件
        assert len(events) == 3, f"应有 3 个 SSE 事件, 实际 {len(events)}"
        assert '"type": "done"' in body

        db.expire_all()
        result = await db.execute(
            select(Paragraph).where(Paragraph.document_id == doc_id).order_by(Paragraph.index)
        )
        paras = result.scalars().all()
        assert paras[14].text_zh == "翻译-位置0", "14 段应写入位置0的翻译"
        assert paras[15].text_zh == "翻译-位置1", "15 段应写入位置1的翻译"
        assert paras[0].text_zh is None, "第 0 段不应被污染"
        assert paras[1].text_zh is None, "第 1 段不应被污染"
        assert stub.calls == [["en14", "en15"]], "AI 应收到提交的段落列表"
    finally:
        await db.close()
        await engine.dispose()


@pytest.mark.asyncio
async def test_stream_endpoint_rejects_mismatched_indices(monkeypatch):
    """indices 长度与 paragraphs 不匹配 → 400。"""
    engine, db = await _make_db()
    try:
        _user_id, doc_id = await _seed_user_doc(db)
        user = (await db.execute(select(User))).scalars().first()

        request = TranslateRequest(
            paragraphs=["a", "b"],
            indices=[14],  # 长度不匹配
            document_id=str(doc_id),
        )
        with pytest.raises(HTTPException) as ei:
            await translate_module.translate_stream(request, db, user)
        assert ei.value.status_code == 400
    finally:
        await db.close()
        await engine.dispose()
