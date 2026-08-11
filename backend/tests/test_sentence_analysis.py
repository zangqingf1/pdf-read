"""测试：句子解析改为认知语言学「画面流」双重拆分。

- 默认 prompt 应输出 原句拆解 / 理解拆解 / 阅读线索 / 地道翻译 四段，不再做语法拆解（主干/讲解）。
- 原句拆解按原词顺序 / 切割、不增删词、块长 3-9 词；理解拆解按时间/因果重组、可调序可补词、输出英文。
- _persist_analyses → _serialize_analysis round-trip 返回相同的 markdown content。
- 旧结构（{"structure": [...], "idiomatic_translation": ...}）仍能被 _serialize_analysis 兼容重建。
"""

import json
import uuid
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.v1.sentences import _persist_analyses, _serialize_analysis
from app.database import Base
from app.models.document import Document
from app.models.sentence_analysis import SentenceAnalysis
from app.services.prompt_defaults import DEFAULT_PROMPTS


# ── Prompt 内容 ──────────────────────────────────────────────────────


def test_default_prompt_uses_dual_split():
    """analyze_sentences 默认 prompt 应按认知语言学画面流做双重拆分，而非语法拆解。"""
    prompt = DEFAULT_PROMPTS["analyze_sentences"]["user_prompt"]
    system = DEFAULT_PROMPTS["analyze_sentences"]["system_prompt"]

    for section in ("**原句拆解**", "**理解拆解**", "**阅读线索**", "**地道翻译**"):
        assert section in prompt, f"prompt 应包含 {section}"
    assert "**主干**" not in prompt, "不应再要求输出语法主干"
    assert "**讲解**" not in prompt, "不应再要求输出语法讲解"

    # 角色设定：认知语言学与自然习得理论专家，聚焦工作记忆容量的线性语意块
    assert "认知语言学与自然习得理论专家" in system, "system prompt 应设定认知语言学专家角色"
    assert "工作记忆" in system, "system prompt 应提及工作记忆容量"
    assert "画面拼接" in system, "system prompt 应提及画面拼接理解"

    # 原句拆解规则：按原词顺序 / 切割、不增删词、块长 3-9 词、保护固定搭配
    assert "不增删任何词" in prompt, "原句拆解应不增删任何词"
    assert "3-9 个单词" in prompt, "原句拆解每块应控制在 3-9 个单词"
    assert "give up" in prompt and "as soon as" in prompt, "应举例说明保护固定搭配"

    # 理解拆解规则：按时间/因果重组，可调序可补词，输出英文，转折词单独成块
    assert "允许调整原文语序和添加单词" in prompt, "理解拆解应允许调序与补词"
    assert "输出英文" in prompt, "理解拆解应输出英文语块"
    assert "however" in prompt, "应举例说明转折词单独成块作为逻辑路标"

    # 仍然使用既有占位符
    assert "{sentence_text}" in prompt


# ── 持久化 round-trip ───────────────────────────────────────────────


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


async def _seed_doc(db: AsyncSession) -> uuid.UUID:
    doc_id = uuid.uuid4()
    db.add(Document(id=doc_id, original_text="", parse_status="completed"))
    await db.commit()
    return doc_id


@pytest.mark.asyncio
async def test_persist_and_serialize_roundtrip():
    """新格式 {"content": markdown} 落库后读回应返回相同 content。"""
    engine, db = await _make_db()
    try:
        doc_id = await _seed_doc(db)
        markdown = (
            "**原句拆解**：The man wearing a black suit / who stood up / is my uncle.\n\n"
            "**理解拆解**：The man / wearing a black suit / stood up / he is my uncle.\n\n"
            "**阅读线索**：按画面顺序理解——先看到那个人，再补穿着，接着是动作，最后揭示身份。"
        )
        await _persist_analyses(
            document_id=str(doc_id),
            analyses=[{
                "paragraph_index": 0,
                "sentence_index": 0,
                "sentence_text": "The man wearing a black suit who stood up is my uncle.",
                "content": markdown,
            }],
            db=db,
        )

        record = (await db.execute(select(SentenceAnalysis))).scalars().first()
        assert record is not None

        result = _serialize_analysis(record)
        assert result.content == markdown, "round-trip 后 content 应逐字一致"
        assert result.paragraph_index == 0
        assert result.sentence_index == 0

        # 落库 JSON 应是 {"content": ...}
        data = json.loads(record.structure_json)
        assert data == {"content": markdown}
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_persist_upsert_overwrites_existing():
    """同一 (paragraph_index, sentence_index) 重复持久化应覆盖旧 content。"""
    engine, db = await _make_db()
    try:
        doc_id = await _seed_doc(db)
        entry = {
            "paragraph_index": 0,
            "sentence_index": 0,
            "sentence_text": "sentence",
            "content": "v1",
        }
        await _persist_analyses(document_id=str(doc_id), analyses=[entry], db=db)
        await _persist_analyses(document_id=str(doc_id), analyses=[{**entry, "content": "v2"}], db=db)

        records = (await db.execute(select(SentenceAnalysis))).scalars().all()
        assert len(records) == 1, "upsert 不应产生重复记录"
        assert json.loads(records[0].structure_json)["content"] == "v2"
    finally:
        await engine.dispose()


def test_serialize_legacy_structure_compat():
    """旧结构 {"structure", "idiomatic_translation", "grammar_highlights"} 应重建为 markdown。"""
    record = SentenceAnalysis(
        id=str(uuid.uuid4()),
        document_id=str(uuid.uuid4()),
        paragraph_index=0,
        sentence_index=0,
        sentence_text="The man who stood up is my uncle.",
        structure_json=json.dumps({
            "structure": [
                {"label": "主句", "text": "The man is my uncle.", "explanation": "核心主系表"}
            ],
            "idiomatic_translation": "那个站起来的男人是我叔叔。",
            "grammar_highlights": ["who stood up 是定语从句"],
        }, ensure_ascii=False),
    )

    result = _serialize_analysis(record)
    for marker in ("**原文**", "**主干**", "**译文**", "**讲解**"):
        assert marker in result.content, f"兼容重建应包含 {marker}"
