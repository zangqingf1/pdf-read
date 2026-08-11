"""测试：全文总结功能。

覆盖 ai_service.summarize_stream（流式/重试/空内容）、summary 端点
（SSE 事件 + 落库 + 所有权）、draft 保存端点、全文截断逻辑。
"""

import asyncio
import json
import uuid
from typing import Any

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.v1 import summary as summary_module
from app.api.v1.summary import _load_document_text, _truncate_document_text
from app.database import Base
from app.models.document import Document
from app.models.paragraph import Paragraph
from app.models.user import User
from app.schemas.summary import SummaryRequest, SummaryDraftRequest
from app.services.ai_service import AIService


class FakeStreamResponse:
    """模拟流式响应：async with 上下文 + raise_for_status + aiter_lines。

    ``fail_after`` 表示在第 N 行被产出之前抛错，用于模拟中途断流。
    """

    def __init__(
        self,
        status: int = 200,
        lines: list[str] | None = None,
        fail_after: int | None = None,
    ):
        self.status = status
        self._lines = lines or []
        self._fail_after = fail_after

    def raise_for_status(self):
        if self.status >= 400:
            req = httpx.Request("POST", "https://fake/v1/chat/completions")
            raise httpx.HTTPStatusError(
                f"HTTP {self.status}",
                request=req,
                response=httpx.Response(self.status, request=req),
            )

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def aiter_lines(self):
        for i, line in enumerate(self._lines):
            if self._fail_after is not None and i >= self._fail_after:
                req = httpx.Request("POST", "https://fake/v1/chat/completions")
                raise httpx.HTTPStatusError(
                    "HTTP 500 mid-stream",
                    request=req,
                    response=httpx.Response(500, request=req),
                )
            yield line


class FakeStreamClient:
    """FakeClient 的流式版：stream() 按序返回预设响应，记录 payloads。

    httpx.AsyncClient.stream() 是同步方法（返回可 async with 的上下文
    管理器），所以这里必须是 def 而非 async def。
    """

    def __init__(self, responses: list):
        self._responses = list(responses)
        self._i = 0
        self.payloads: list[dict] = []

    def stream(self, method, url, json=None):
        if json:
            self.payloads.append(json)
        resp = self._responses[min(self._i, len(self._responses) - 1)]
        self._i += 1
        return resp


def _make_service(fake: FakeStreamClient) -> AIService:
    ai = AIService(api_key="test-key", base_url="https://fake/v1")
    ai._client = fake  # type: ignore[attr-defined]
    return ai


def _sse_lines(text: str, chunk_size: int = 4) -> list[str]:
    """把内容切成小块模拟流式 data: delta 事件 + [DONE] 行。"""
    lines = []
    for i in range(0, len(text), chunk_size):
        chunk = text[i : i + chunk_size]
        lines.append(
            f"data: {json.dumps({'choices': [{'delta': {'content': chunk}}]})}"
        )
    lines.append("data: [DONE]")
    return lines


async def _no_sleep(_: float) -> None:
    return None


# ── ai_service.summarize_stream ───────────────────────────────────────


@pytest.mark.asyncio
async def test_summarize_stream_generates_chunks_and_done():
    """流式总结：payload 禁用 thinking、走 summary prompt、含全文；
    chunk 事件逐块产出，done 事件带完整总结。"""
    fake = FakeStreamClient([FakeStreamResponse(lines=_sse_lines("The summary text"))])
    ai = _make_service(fake)

    events = [e async for e in ai.summarize_stream("Para one.\n\nPara two.")]

    chunks = [e for e in events if e["type"] == "chunk"]
    # "The summary text" = 16 字符，chunk_size=4 → 4 个 chunk 事件
    assert len(chunks) == 4, f"应有 4 个 chunk, 实际 {len(chunks)}"
    assert events[-1]["type"] == "done"
    assert "".join(e["text"] for e in chunks) == "The summary text"
    assert events[-1]["summary"] == "The summary text"

    assert fake.payloads, "应发出过 AI 请求"
    payload = fake.payloads[0]
    assert payload.get("thinking") == {"type": "disabled"}
    assert payload.get("stream") is True
    user_msg = payload["messages"][-1]["content"]
    assert "Para one." in user_msg and "Para two." in user_msg, "全文应填入 prompt"
    assert "The summary text" not in user_msg, "AI 输出不应出现在请求里"


@pytest.mark.asyncio
async def test_summarize_stream_revise_includes_user_draft():
    """revise 模式：用户草稿应填入 prompt 的 {user_summary} 占位符。"""
    fake = FakeStreamClient([FakeStreamResponse(lines=_sse_lines("Revised"))])
    ai = _make_service(fake)

    events = [e async for e in ai.summarize_stream("Article body", "My draft")]

    assert events[-1]["summary"] == "Revised"
    user_msg = fake.payloads[0]["messages"][-1]["content"]
    assert "My draft" in user_msg, "草稿应填入 prompt"


@pytest.mark.asyncio
async def test_summarize_stream_retries_before_first_chunk(monkeypatch):
    """首 chunk 前失败（500）→ 重试；重试成功后无重复 chunk。"""
    monkeypatch.setattr(asyncio, "sleep", _no_sleep)
    fake = FakeStreamClient(
        [
            FakeStreamResponse(status=500),
            FakeStreamResponse(lines=_sse_lines("Recovered")),
        ]
    )
    ai = _make_service(fake)

    events = [e async for e in ai.summarize_stream("Article")]

    assert len(fake.payloads) == 2, "应重试 1 次"
    chunks = [e["text"] for e in events if e["type"] == "chunk"]
    assert "".join(chunks) == "Recovered", "不应有重复文本"
    assert events[-1]["summary"] == "Recovered"


@pytest.mark.asyncio
async def test_summarize_stream_does_not_retry_after_first_chunk(monkeypatch):
    """首 chunk 已发出后断流 → 不重试，直接抛 RuntimeError。"""
    monkeypatch.setattr(asyncio, "sleep", _no_sleep)
    fake = FakeStreamClient(
        [
            FakeStreamResponse(lines=_sse_lines("Partial text"), fail_after=2),
            FakeStreamResponse(lines=_sse_lines("Should not be used")),
        ]
    )
    ai = _make_service(fake)

    with pytest.raises(RuntimeError):
        _ = [e async for e in ai.summarize_stream("Article")]

    assert len(fake.payloads) == 1, "中途失败不应重试"


@pytest.mark.asyncio
async def test_summarize_stream_empty_content_raises_runtime_error(monkeypatch):
    """连续 3 次空内容 → RuntimeError（非 ValueError，可被端点重试映射）。"""
    monkeypatch.setattr(asyncio, "sleep", _no_sleep)
    fake = FakeStreamClient(
        [FakeStreamResponse(lines=["data: [DONE]"])] * 3
    )
    ai = _make_service(fake)

    with pytest.raises(RuntimeError) as ei:
        _ = [e async for e in ai.summarize_stream("Article")]

    assert "空内容" in str(ei.value)
    assert len(fake.payloads) == 3


@pytest.mark.asyncio
async def test_summarize_stream_missing_api_key_raises_value_error():
    """缺 API Key → ValueError（端点映射为 400，提示配置 Key）。"""
    fake = FakeStreamClient([])
    ai = AIService(api_key="", base_url="https://fake/v1")
    ai._client = fake  # type: ignore[attr-defined]

    with pytest.raises(ValueError):
        _ = [e async for e in ai.summarize_stream("Article")]

    assert fake.payloads == [], "缺 Key 不应发请求"


# ── 全文截断 ──────────────────────────────────────────────────────────


def test_truncate_document_text_keeps_head_and_tail():
    """超限文本保留 head 60% + tail 40%，中间加省略标记，总长不超限。"""
    text = "A" * 300
    result = _truncate_document_text(text, max_chars=100)

    assert len(result) <= 100
    marker = "\n\n[… 中间内容省略 …]\n\n"
    assert result.count("A") == 100 - len(marker), "head+tail 应填满剩余配额"
    assert "中间内容省略" in result
    # head 占比约 60%
    assert result.find(marker) > result.count("A") * 0.5, "head 部分应占大头"


def test_truncate_document_text_passthrough_short_text():
    assert _truncate_document_text("short", max_chars=100) == "short"


async def _make_db() -> tuple[Any, AsyncSession]:
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)()
    return engine, session


async def _seed_user_doc(db: AsyncSession, count: int = 4) -> tuple[uuid.UUID, uuid.UUID]:
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
async def test_load_document_text_joins_paragraphs_in_order():
    """文档全文 = 按 index 排序的段落拼接，超限时截断。"""
    engine, db = await _make_db()
    try:
        _user_id, doc_id = await _seed_user_doc(db)

        text = await _load_document_text(db, str(doc_id), max_chars=10000)
        assert text == "en0\n\nen1\n\nen2\n\nen3", f"实际: {text!r}"

        truncated = await _load_document_text(db, str(doc_id), max_chars=8)
        assert len(truncated) <= 8
        assert "en0" in truncated, "应保留开头段落"
    finally:
        await db.close()
        await engine.dispose()


# ── 端点级接线 ────────────────────────────────────────────────────────


class _StubAI:
    """最小 AIService 替身：记录收到的全文与草稿，产出确定性流。"""

    def __init__(self):
        self.calls: list[tuple[str, str | None]] = []

    async def summarize_stream(self, document_text, user_summary=None, **kwargs):
        self.calls.append((document_text, user_summary))
        yield {"type": "chunk", "text": "First"}
        yield {"type": "chunk", "text": " half."}
        yield {"type": "done", "summary": "First half."}


async def _collect_events(resp) -> list[dict]:
    chunks = []
    async for chunk in resp.body_iterator:
        chunks.append(chunk)
    body = "".join(chunks)
    return [
        json.loads(line[6:])
        for line in body.split("\n")
        if line.startswith("data: ")
    ]


@pytest.mark.asyncio
async def test_stream_endpoint_generates_and_persists(monkeypatch):
    """POST /summary/stream 完整接线：chunk + done 事件，done 后落库。"""
    engine, db = await _make_db()
    try:
        user_id, doc_id = await _seed_user_doc(db)
        user = (await db.execute(select(User).where(User.id == user_id))).scalar_one()

        stub = _StubAI()
        monkeypatch.setattr(summary_module, "create_ai_service", lambda *a, **k: stub)

        request = SummaryRequest(document_id=str(doc_id), mode="generate")
        resp = await summary_module.summarize_document_stream(request, db, user)

        events = await _collect_events(resp)
        assert [e["type"] for e in events] == ["chunk", "chunk", "done"]
        assert events[-1]["summary"] == "First half."

        # AI 应收到按段落拼接的全文
        assert stub.calls[0][0] == "en0\n\nen1\n\nen2\n\nen3"
        assert stub.calls[0][1] is None, "generate 模式不应传草稿"

        db.expire_all()
        doc = (await db.execute(select(Document).where(Document.id == doc_id))).scalar_one()
        assert doc.summary == "First half.", "done 事件后应落库"
    finally:
        await db.close()
        await engine.dispose()


@pytest.mark.asyncio
async def test_stream_endpoint_revise_passes_draft(monkeypatch):
    """revise 模式：草稿传给 AI，并覆盖持久化。"""
    engine, db = await _make_db()
    try:
        user_id, doc_id = await _seed_user_doc(db)
        user = (await db.execute(select(User).where(User.id == user_id))).scalar_one()

        stub = _StubAI()
        monkeypatch.setattr(summary_module, "create_ai_service", lambda *a, **k: stub)

        request = SummaryRequest(
            document_id=str(doc_id), mode="revise", user_summary="My draft"
        )
        resp = await summary_module.summarize_document_stream(request, db, user)

        events = await _collect_events(resp)
        assert events[-1]["type"] == "done"
        assert stub.calls[0][1] == "My draft", "revise 模式应传草稿"
    finally:
        await db.close()
        await engine.dispose()


@pytest.mark.asyncio
async def test_stream_endpoint_rejects_empty_revise_draft():
    """revise 模式无草稿 → 400（在流开始前抛出）。"""
    engine, db = await _make_db()
    try:
        _user_id, doc_id = await _seed_user_doc(db)
        user = (await db.execute(select(User))).scalars().first()

        request = SummaryRequest(document_id=str(doc_id), mode="revise")
        with pytest.raises(HTTPException) as ei:
            await summary_module.summarize_document_stream(request, db, user)
        assert ei.value.status_code == 400
    finally:
        await db.close()
        await engine.dispose()


@pytest.mark.asyncio
async def test_stream_endpoint_404_for_foreign_document():
    """非本人文档 → 404。"""
    engine, db = await _make_db()
    try:
        user1 = User(id=uuid.uuid4(), email="u1@t.com")
        user2 = User(id=uuid.uuid4(), email="u2@t.com")
        doc = Document(
            id=uuid.uuid4(), original_text="", parse_status="completed", user_id=user2.id
        )
        db.add_all([user1, user2, doc])
        await db.commit()

        request = SummaryRequest(document_id=str(doc.id), mode="generate")
        with pytest.raises(HTTPException) as ei:
            await summary_module.summarize_document_stream(request, db, user1)
        assert ei.value.status_code == 404
    finally:
        await db.close()
        await engine.dispose()


@pytest.mark.asyncio
async def test_draft_endpoint_saves_and_clears():
    """PUT /summary/draft：非空草稿落库；空白草稿 = 清空（前端清空按钮语义）。"""
    engine, db = await _make_db()
    try:
        user_id, doc_id = await _seed_user_doc(db)
        user = (await db.execute(select(User).where(User.id == user_id))).scalar_one()

        resp = await summary_module.save_summary_draft(
            SummaryDraftRequest(document_id=str(doc_id), summary="My manual summary"),
            db,
            user,
        )
        assert resp.saved is True

        db.expire_all()
        doc = (await db.execute(select(Document).where(Document.id == doc_id))).scalar_one()
        assert doc.summary == "My manual summary"

        # 空白草稿 → 清空已存内容（防抖自动保存不会发空白请求，
        # 只有用户主动"清空"会触发，因此不会误删）
        # 注意：expire_all 后旧 user 实例属性已过期，需重新查询再传入
        user = await db.get(User, user_id)
        await summary_module.save_summary_draft(
            SummaryDraftRequest(document_id=str(doc_id), summary="   "),
            db,
            user,
        )
        db.expire_all()
        doc = (await db.execute(select(Document).where(Document.id == doc_id))).scalar_one()
        assert doc.summary is None, "空白草稿应清空已存内容"
    finally:
        await db.close()
        await engine.dispose()
