"""考纲标签（ECDICT 离线判定）单元测试。"""

import pytest

from app.services import dictionary_service as ds

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def _require_ecdict():
    if ds._dict_db_path() is None:
        pytest.skip("本地 ECDICT 数据库不存在，跳过考纲标签测试")
    ds._exam_tags_cache.clear()
    yield
    ds._exam_tags_cache.clear()


async def test_lookup_exam_tags_basic():
    """多标签命中 + 固定顺序；只含 ECDICT tag 列原生标签（无 COCA 派生）。"""
    res = await ds.lookup_exam_tags(["abandon"])
    tags = res["abandon"]
    for expected in ("高中", "四级", "六级", "考研", "托福", "GRE"):
        assert expected in tags
    assert "COCA" not in tags
    # 固定顺序输出
    assert tags == [t for t in ds.EXAM_TAG_ORDER if t in tags]


async def test_lookup_exam_tags_lemma_fallback():
    """屈折变化词兜底到原形标签（went → go）。"""
    res = await ds.lookup_exam_tags(["went"])
    assert "初中" in res["went"]


async def test_lookup_exam_tags_case_insensitive_and_unknown():
    """大小写不敏感；词表外单词返回空列表而非报错。"""
    res = await ds.lookup_exam_tags(["CAT", "zzznotaword"])
    assert len(res["cat"]) > 0
    assert res["zzznotaword"] == []


async def test_lookup_exam_tags_empty_input():
    assert await ds.lookup_exam_tags([]) == {}
