"""测试在线单词发音（edge-tts 服务 + 路由错误映射）。

不消耗真实网络：mock `edge_tts.Communicate`，断言：
- synthesize 正确收集音频字节、使用对应英音/美音音色
- 内存缓存（重复调用不重新触发 edge-tts）
- 空单词 / 非法口音 → TTSUnavailableError
- edge-tts 异常 → TTSUnavailableError
- 路由层：成功返回 audio/mpeg，失败映射 502
"""

import pytest
from fastapi import HTTPException

from app.api.v1 import tts as tts_module
from app.api.v1.tts import word_tts
from app.services import tts_service
from app.services.tts_service import TTSUnavailableError, synthesize


class _FakeUser:
    id = "u-test"
    email = "tts@example.com"


class _FakeCommunicate:
    """模拟 edge_tts.Communicate：按预设音频块流式返回。"""

    def __init__(self, text: str, voice: str, **kwargs):
        self.text = text
        self.voice = voice

    async def stream(self):
        yield {"type": "audio", "data": b"ID3-fake-"}
        yield {"type": "audio", "data": b"mp3-bytes"}
        yield {"type": "WordBoundary", "text": self.text}


@pytest.fixture
def mock_edge(monkeypatch):
    """替换 edge_tts.Communicate，记录调用参数；关闭磁盘缓存避免写文件。"""
    calls: list[tuple[str, str]] = []
    tts_service._cache.clear()
    monkeypatch.setattr(tts_service, "_cache_dir", None)

    def fake_communicate(text: str, voice: str = "", **kwargs):
        calls.append((text, voice))
        return _FakeCommunicate(text, voice)

    monkeypatch.setattr(tts_service.edge_tts, "Communicate", fake_communicate)
    yield calls
    tts_service._cache.clear()


@pytest.mark.asyncio
async def test_synthesize_returns_mp3_bytes(mock_edge):
    audio = await synthesize("hello", "us")
    assert audio == b"ID3-fake-mp3-bytes"
    assert mock_edge == [("hello", "en-US-JennyNeural")]


@pytest.mark.asyncio
async def test_synthesize_uk_uses_british_voice(mock_edge):
    await synthesize("hello", "uk")
    assert mock_edge == [("hello", "en-GB-SoniaNeural")]


@pytest.mark.asyncio
async def test_synthesize_caches_repeated_word(mock_edge):
    # 先清缓存，保证首次调用
    tts_service._cache.clear()
    await synthesize("hello", "us")
    await synthesize("hello", "us")
    # 第二次命中缓存，edge-tts 只被调用一次
    assert len(mock_edge) == 1


@pytest.mark.asyncio
async def test_disk_cache_persists(tmp_path, monkeypatch):
    """首次走 edge-tts 并写盘；清空内存缓存后再次调用命中磁盘，不再触发 edge-tts。"""
    calls: list[tuple[str, str]] = []
    tts_service._cache.clear()
    monkeypatch.setattr(tts_service, "_cache_dir", tmp_path)

    def fake_communicate(text: str, voice: str = "", **kwargs):
        calls.append((text, voice))
        return _FakeCommunicate(text, voice)

    monkeypatch.setattr(tts_service.edge_tts, "Communicate", fake_communicate)

    await synthesize("hello", "us")
    assert len(calls) == 1

    # 清空内存缓存 → 应命中磁盘，edge-tts 不再被调用
    tts_service._cache.clear()
    audio = await synthesize("hello", "us")
    assert audio == b"ID3-fake-mp3-bytes"
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_empty_word_rejected(mock_edge):
    with pytest.raises(TTSUnavailableError):
        await synthesize("   ", "us")


@pytest.mark.asyncio
async def test_unknown_accent_rejected(mock_edge):
    with pytest.raises(TTSUnavailableError):
        await synthesize("hello", "fr")


@pytest.mark.asyncio
async def test_edge_tts_failure_maps_to_error(mock_edge):
    def failing_communicate(text: str, voice: str = "", **kwargs):
        raise RuntimeError("network down")

    tts_service.edge_tts.Communicate = failing_communicate  # type: ignore[assignment]
    with pytest.raises(TTSUnavailableError):
        await synthesize("hello", "us")


@pytest.mark.asyncio
async def test_route_success_returns_audio_mpeg(mock_edge):
    resp = await word_tts("hello", "us", current_user=_FakeUser())
    assert resp.status_code == 200
    assert resp.media_type == "audio/mpeg"
    assert resp.body == b"ID3-fake-mp3-bytes"


@pytest.mark.asyncio
async def test_route_maps_failure_to_502(monkeypatch):
    async def _raise(word: str, accent: str):
        raise TTSUnavailableError("boom")

    monkeypatch.setattr(tts_module, "synthesize", _raise)
    with pytest.raises(HTTPException) as exc_info:
        await word_tts("hello", "us", current_user=_FakeUser())
    assert exc_info.value.status_code == 502
