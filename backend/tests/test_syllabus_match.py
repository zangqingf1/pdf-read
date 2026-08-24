"""考纲标注（阅读页高亮）端点单元测试 — 离线，mock lookup_exam_tags。"""

import pytest
from fastapi import HTTPException

from app.api.v1.words import match_syllabus_words
from app.schemas.words import SyllabusMatchRequest

pytestmark = pytest.mark.asyncio


class _FakeUser:
    id = "u1"


async def test_syllabus_match_basic(monkeypatch):
    async def fake_lookup(words):
        return {"book": ["初中", "高中", "雅思"], "cat": ["初中"], "zzz": []}

    monkeypatch.setattr("app.api.v1.words.lookup_exam_tags", fake_lookup)
    req = SyllabusMatchRequest(tags=["初中", "考研"], words=["book", "cat", "zzz"])
    res = await match_syllabus_words(req, _FakeUser())
    # book 命中初中；cat 命中初中；zzz 无标签不命中
    assert res.matched == ["book", "cat"]


async def test_syllabus_match_no_intersection(monkeypatch):
    async def fake_lookup(words):
        return {w: ["GRE"] for w in words}

    monkeypatch.setattr("app.api.v1.words.lookup_exam_tags", fake_lookup)
    req = SyllabusMatchRequest(tags=["四级"], words=["obscureword"])
    res = await match_syllabus_words(req, _FakeUser())
    assert res.matched == []


async def test_syllabus_match_blank_tags_returns_empty():
    req = SyllabusMatchRequest(tags=["  ", ""], words=["book"])
    res = await match_syllabus_words(req, _FakeUser())
    assert res.matched == []


async def test_syllabus_match_lookup_failure(monkeypatch):
    async def broken_lookup(words):
        raise RuntimeError("db gone")

    monkeypatch.setattr("app.api.v1.words.lookup_exam_tags", broken_lookup)
    req = SyllabusMatchRequest(tags=["四级"], words=["book"])
    with pytest.raises(HTTPException) as exc:
        await match_syllabus_words(req, _FakeUser())
    assert exc.value.status_code == 502
