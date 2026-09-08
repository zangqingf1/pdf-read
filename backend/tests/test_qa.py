"""测试：文档 AI 问答功能。

覆盖 ai_service.chat_stream（流式/重试/缺 Key）、qa 端点
（SSE 事件 + done 后落库 + 历史回放 + prompt_name 分模板 + 所有权）、
对话恢复与清空端点。
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

from app.api.v1 import qa as qa_module
from app.database import Base
from app.models.document import Document
from app.models.paragraph import Paragraph
from app.models.qa_message import QaMessage
from app.models.user import User
from app.schemas.qa import QaStreamRequest
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


# ── ai_service.chat_stream ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_chat_stream_generates_chunks_and_done():
    """流式问答：payload 禁用 thinking、messages 原样透传；
    chunk 事件逐块产出，done 事件带完整回答。"""
    fake = FakeStreamClient([FakeStreamResponse(lines=_sse_lines("The answer"))])
    ai = _make_service(fake)
    messages = [
        {"role": "system", "content": "system context"},
        {"role": "user", "content": "question"},
    ]

    events = [e async for e in ai.chat_stream(messages)]

    chunks = [e for e in events if e["type"] == "chunk"]
    assert events[-1]["type"] == "done"
    assert "".join(e["text"] for e in chunks) == "The answer"
    assert events[-1]["text"] == "The answer"

    payload = fake.payloads[0]
    assert payload.get("thinking") == {"type": "disabled"}
    assert payload.get("stream") is True
    assert payload["messages"] == messages, "messages 应原样透传给 AI"


@pytest.mark.asyncio
async def test_chat_stream_retries_before_first_chunk(monkeypatch):
    """首 chunk 前失败（500）→ 重试；重试成功后无重复 chunk。"""
    monkeypatch.setattr(asyncio, "sleep", _no_sleep)
    fake = FakeStreamClient(
        [
            FakeStreamResponse(status=500),
            FakeStreamResponse(lines=_sse_lines("Recovered")),
        ]
    )
    ai = _make_service(fake)

    events = [e async for e in ai.chat_stream([{"role": "user", "content": "q"}])]

    assert len(fake.payloads) == 2, "应重试 1 次"
    chunks = [e["text"] for e in events if e["type"] == "chunk"]
    assert "".join(chunks) == "Recovered", "不应有重复文本"


@pytest.mark.asyncio
async def test_chat_stream_does_not_retry_after_first_chunk(monkeypatch):
    """首 chunk 已发出后断流 → 不重试，直接抛 RuntimeError。"""
    monkeypatch.setattr(asyncio, "sleep", _no_sleep)
    fake = FakeStreamClient(
        [
            FakeStreamResponse(lines=_sse_lines("Partial"), fail_after=2),
            FakeStreamResponse(lines=_sse_lines("Should not be used")),
        ]
    )
    ai = _make_service(fake)

    with pytest.raises(RuntimeError):
        _ = [e async for e in ai.chat_stream([{"role": "user", "content": "q"}])]

    assert len(fake.payloads) == 1, "中途失败不应重试"


@pytest.mark.asyncio
async def test_chat_stream_missing_api_key_raises_value_error():
    """缺 API Key → ValueError（端点映射为 400，提示配置 Key）。"""
    fake = FakeStreamClient([])
    ai = AIService(api_key="", base_url="https://fake/v1")
    ai._client = fake  # type: ignore[attr-defined]

    with pytest.raises(ValueError):
        _ = [e async for e in ai.chat_stream([{"role": "user", "content": "q"}])]

    assert fake.payloads == [], "缺 Key 不应发请求"


# ── 端点级接线 ────────────────────────────────────────────────────────


class _StubAI:
    """最小 AIService 替身：记录收到的 messages，产出确定性流。"""

    def __init__(self):
        self.calls: list[list[dict]] = []

    async def chat_stream(self, messages, **kwargs):
        self.calls.append(messages)
        yield {"type": "chunk", "text": "First"}
        yield {"type": "chunk", "text": " answer."}
        yield {"type": "done", "text": "First answer."}

    async def close(self):
        """模拟真实 AIService 的清理接口（端点 finally 会调用）。"""
        return None


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


async def _seed_user_doc(db: AsyncSession) -> tuple[User, uuid.UUID]:
    user = User(id=uuid.uuid4(), email=f"u{uuid.uuid4().hex}@t.com")
    doc = Document(
        id=uuid.uuid4(), original_text="", parse_status="completed", user_id=user.id
    )
    db.add_all([user, doc])
    db.add(Paragraph(document_id=doc.id, index=0, text_en="Target paragraph."))
    db.add(Paragraph(document_id=doc.id, index=1, text_en="Next paragraph."))
    await db.commit()
    return user, doc.id


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
async def test_stream_endpoint_answers_and_persists(monkeypatch):
    """POST /qa/stream 完整接线：chunk + done 事件，done 后 user+assistant 落库；
    messages 含 system 上下文（全文/标题）与当前问题。"""
    engine, db = await _make_db()
    try:
        user, doc_id = await _seed_user_doc(db)

        stub = _StubAI()
        monkeypatch.setattr(qa_module, "create_ai_service", lambda *a, **k: stub)

        request = QaStreamRequest(
            document_id=str(doc_id), question="这段在说什么？"
        )
        resp = await qa_module.qa_stream(request, db, user)

        events = await _collect_events(resp)
        assert [e["type"] for e in events] == ["chunk", "chunk", "done"]
        assert events[-1]["user_message_id"] > 0
        assert events[-1]["assistant_message_id"] > 0

        # messages 组装：system 含全文与标题，末尾是当前问题
        sent = stub.calls[0]
        assert sent[0]["role"] == "system"
        assert "Target paragraph." in sent[0]["content"], "全文应进 system 上下文"
        assert sent[-1] == {"role": "user", "content": "这段在说什么？"}

        db.expire_all()
        rows = (
            await db.execute(
                select(QaMessage)
                .where(QaMessage.document_id == doc_id)
                .order_by(QaMessage.id)
            )
        ).scalars().all()
        assert [(r.role, r.content) for r in rows] == [
            ("user", "这段在说什么？"),
            ("assistant", "First answer."),
        ], "done 后应落库 user + assistant 两条"
        assert rows[0].paragraph_index is None
        assert rows[1].prompt_name == "doc_qa"
    finally:
        await db.close()
        await engine.dispose()


@pytest.mark.asyncio
async def test_stream_endpoint_replays_history(monkeypatch):
    """已有对话历史 → 按 id 顺序回放进 messages（最近 N 条内）。"""
    engine, db = await _make_db()
    try:
        user, doc_id = await _seed_user_doc(db)
        db.add_all(
            [
                QaMessage(document_id=doc_id, role="user", content="旧问题"),
                QaMessage(
                    document_id=doc_id,
                    role="assistant",
                    content="旧回答",
                    prompt_name="doc_qa",
                ),
            ]
        )
        await db.commit()

        stub = _StubAI()
        monkeypatch.setattr(qa_module, "create_ai_service", lambda *a, **k: stub)

        request = QaStreamRequest(document_id=str(doc_id), question="新问题")
        resp = await qa_module.qa_stream(request, db, user)
        await _collect_events(resp)

        sent = stub.calls[0]
        # [system, 旧问题(user), 旧回答(assistant), 新问题(user)]
        assert [m["content"] for m in sent[1:]] == ["旧问题", "旧回答", "新问题"]
        assert sent[1]["role"] == "user" and sent[2]["role"] == "assistant"
    finally:
        await db.close()
        await engine.dispose()


@pytest.mark.asyncio
async def test_stream_endpoint_quiz_prompt_and_target_sentence(monkeypatch):
    """prompt_name=doc_quiz 走出题模板；引用句带段落上下文。"""
    engine, db = await _make_db()
    try:
        user, doc_id = await _seed_user_doc(db)

        stub = _StubAI()
        monkeypatch.setattr(qa_module, "create_ai_service", lambda *a, **k: stub)

        request = QaStreamRequest(
            document_id=str(doc_id),
            question="出 3 道阅读理解题",
            prompt_name="doc_quiz",
            target_paragraph_index=0,
            target_sentence="Target paragraph.",
        )
        resp = await qa_module.qa_stream(request, db, user)
        await _collect_events(resp)

        system_msg = stub.calls[0][0]["content"]
        assert "阅读理解" in system_msg, "应使用 doc_quiz 出题模板"
        assert "Target paragraph." in system_msg, "引用句应进上下文"
        assert "Next paragraph." in system_msg, "相邻段落应进 paragraph_context"

        db.expire_all()
        rows = (
            await db.execute(
                select(QaMessage).where(QaMessage.document_id == doc_id)
            )
        ).scalars().all()
        assert rows[0].paragraph_index == 0, "引用段落索引应落库"
        assert rows[1].prompt_name == "doc_quiz"
    finally:
        await db.close()
        await engine.dispose()


@pytest.mark.asyncio
async def test_stream_endpoint_quote_reaches_user_message(monkeypatch):
    """引用句必须无条件到达最后一条用户消息（不依赖模板占位符）。

    doc_quiz 的 system 模板不含 {target_sentence}/{paragraph_context}，
    若只靠模板注入，引用句会被静默丢弃、模型回复「找不到句子」。
    """
    engine, db = await _make_db()
    try:
        user, doc_id = await _seed_user_doc(db)

        stub = _StubAI()
        monkeypatch.setattr(qa_module, "create_ai_service", lambda *a, **k: stub)

        request = QaStreamRequest(
            document_id=str(doc_id),
            question="这句话为什么用这个时态？",
            prompt_name="doc_quiz",
            target_paragraph_index=0,
            target_sentence="Target paragraph.",
        )
        resp = await qa_module.qa_stream(request, db, user)
        await _collect_events(resp)

        user_msg = stub.calls[0][-1]
        assert user_msg["role"] == "user"
        assert "Target paragraph." in user_msg["content"], "引用句应追加进用户消息"
        assert "Next paragraph." in user_msg["content"], "段落上下文应追加进用户消息"
    finally:
        await db.close()
        await engine.dispose()


@pytest.mark.asyncio
async def test_stream_endpoint_rejects_empty_question():
    """空白问题 → 400（在流开始前抛出）。"""
    engine, db = await _make_db()
    try:
        user, doc_id = await _seed_user_doc(db)

        request = QaStreamRequest(document_id=str(doc_id), question="   ")
        with pytest.raises(HTTPException) as ei:
            await qa_module.qa_stream(request, db, user)
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

        request = QaStreamRequest(document_id=str(doc.id), question="hi")
        with pytest.raises(HTTPException) as ei:
            await qa_module.qa_stream(request, db, user1)
        assert ei.value.status_code == 404
    finally:
        await db.close()
        await engine.dispose()


@pytest.mark.asyncio
async def test_list_and_clear_messages_endpoints():
    """GET /qa/messages 按序恢复对话；DELETE 清空并返回删除数。"""
    engine, db = await _make_db()
    try:
        user, doc_id = await _seed_user_doc(db)
        db.add_all(
            [
                QaMessage(document_id=doc_id, role="user", content="q1"),
                QaMessage(
                    document_id=doc_id,
                    role="assistant",
                    content="a1",
                    prompt_name="doc_qa",
                ),
            ]
        )
        await db.commit()

        resp = await qa_module.list_qa_messages(str(doc_id), db, user)
        assert [m.role for m in resp.messages] == ["user", "assistant"]
        assert resp.messages[0].content == "q1"
        assert resp.messages[0].id < resp.messages[1].id, "应按 id 升序"
        assert resp.messages[1].created_at != ""

        cleared = await qa_module.clear_qa_messages(str(doc_id), db, user)
        assert cleared.deleted == 2

        resp_after = await qa_module.list_qa_messages(str(doc_id), db, user)
        assert resp_after.messages == []
    finally:
        await db.close()
        await engine.dispose()
