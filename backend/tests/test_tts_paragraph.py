"""测试段落朗读合成（edge-tts WordBoundary 时间戳 + 路由）。

不消耗真实网络：mock `edge_tts.Communicate`，断言：
- synthesize_paragraph 正确拼接音频、收集词级时间戳（ticks→ms 换算）
- 语速参数透传 / 非法语速回退默认
- 内存 / 磁盘缓存（重复调用不重新触发 edge-tts）
- 空文本 / 非法口音 / edge-tts 异常 → TTSUnavailableError
- 路由层：成功返回 base64 + boundaries；无权限/段不存在 → 404；失败 → 502
"""

import base64

import pytest
from fastapi import HTTPException

from app.api.v1 import tts as tts_module
from app.api.v1.tts import paragraph_tts
from app.services import tts_service
from app.services.tts_service import TTSUnavailableError, synthesize_paragraph


class _FakeUser:
    id = "u-test"
    email = "tts@example.com"


class _FakeDoc:
    user_id = "u-test"


class _FakePara:
    text_en = "Hello world. This is a test."


class _FakeScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeDB:
    def __init__(self, doc=None, para=None):
        self._doc = doc
        self._para = para

    async def get(self, model, pk):
        return self._doc

    async def execute(self, stmt):
        return _FakeScalarResult(self._para)


class _FakeCommunicate:
    """模拟 edge_tts.Communicate：按预设音频块 + WordBoundary 流式返回。"""

    def __init__(self, text: str, voice: str, **kwargs):
        self.text = text
        self.voice = voice
        self.kwargs = kwargs

    async def stream(self):
        yield {"type": "audio", "data": b"ID3-fake-"}
        yield {"type": "audio", "data": b"mp3-bytes"}
        # offset/duration 单位为 100ns ticks：10_000_000 = 1000ms
        yield {"type": "WordBoundary", "text": "Hello", "offset": 0, "duration": 10_000_000}
        yield {"type": "WordBoundary", "text": "world.", "offset": 10_000_000, "duration": 5_000_000}
        yield {"type": "WordBoundary", "text": "This", "offset": 20_000_000, "duration": 5_000_000}
        yield {"type": "WordBoundary", "text": "is", "offset": 30_000_000, "duration": 5_000_000}
        yield {"type": "WordBoundary", "text": "a", "offset": 40_000_000, "duration": 5_000_000}
        yield {"type": "WordBoundary", "text": "test.", "offset": 50_000_000, "duration": 5_000_000}


@pytest.fixture
def mock_edge(monkeypatch):
    """替换 edge_tts.Communicate，记录调用参数；关闭磁盘缓存避免写文件。"""
    calls: list[tuple[str, str, dict]] = []
    tts_service._para_cache.clear()
    monkeypatch.setattr(tts_service, "_cache_dir", None)

    def fake_communicate(text: str, voice: str = "", **kwargs):
        calls.append((text, voice, kwargs))
        return _FakeCommunicate(text, voice, **kwargs)

    monkeypatch.setattr(tts_service.edge_tts, "Communicate", fake_communicate)
    yield calls
    tts_service._para_cache.clear()


async def _run_route(db, monkeypatch, **params):
    """直接调用路由函数，mock 段落合成返回固定音频与边界。"""
    async def _fake_synth(text, accent, rate):
        boundaries = [
            {"text": "Hello", "offset_ms": 0, "duration_ms": 1000},
            {"text": "world.", "offset_ms": 1000, "duration_ms": 500},
        ]
        return b"mp3-fake", boundaries

    monkeypatch.setattr(tts_module, "synthesize_paragraph", _fake_synth)
    return await paragraph_tts(
        "11111111-1111-1111-1111-111111111111",
        index=0,
        accent="us",
        rate="+0%",
        current_user=_FakeUser(),
        db=db,
    )


@pytest.mark.asyncio
async def test_synthesize_paragraph_returns_audio_and_boundaries(mock_edge):
    audio, boundaries = await synthesize_paragraph("Hello world.", "us")
    assert audio == b"ID3-fake-mp3-bytes"
    assert boundaries[0] == {"text": "Hello", "offset_ms": 0, "duration_ms": 1000}
    assert boundaries[-1] == {"text": "test.", "offset_ms": 5000, "duration_ms": 500}
    # ticks → ms：50_000_000 ticks = 5000ms
    assert boundaries[-1]["offset_ms"] == 5000


@pytest.mark.asyncio
async def test_synthesize_paragraph_voice_and_rate(mock_edge):
    await synthesize_paragraph("Hello", "uk", "-10%")
    text, voice, kwargs = mock_edge[0]
    assert voice == "en-GB-SoniaNeural"
    assert kwargs["rate"] == "-10%"
    assert kwargs["boundary"] == "WordBoundary"


@pytest.mark.asyncio
async def test_synthesize_paragraph_invalid_rate_falls_back(mock_edge):
    await synthesize_paragraph("Hello", "us", "fast!!!")
    text, voice, kwargs = mock_edge[0]
    assert kwargs["rate"] == "+0%"


@pytest.mark.asyncio
async def test_synthesize_paragraph_rate_normalized_to_signed(mock_edge):
    """edge-tts 拒绝无符号 rate（`0%` → Invalid rate），必须补成 `+0%`/`+10%`。"""
    await synthesize_paragraph("Hello", "us", "0%")
    _, _, kwargs = mock_edge[0]
    assert kwargs["rate"] == "+0%"

    await synthesize_paragraph("Hello", "us", "10%")
    _, _, kwargs = mock_edge[1]
    assert kwargs["rate"] == "+10%"

    await synthesize_paragraph("Hello", "us", "-20%")
    _, _, kwargs = mock_edge[2]
    assert kwargs["rate"] == "-20%"


@pytest.mark.asyncio
async def test_synthesize_paragraph_caches_repeated_call(mock_edge):
    tts_service._para_cache.clear()
    await synthesize_paragraph("Hello world.", "us")
    await synthesize_paragraph("Hello world.", "us")
    assert len(mock_edge) == 1


@pytest.mark.asyncio
async def test_synthesize_paragraph_disk_cache_persists(tmp_path, monkeypatch):
    calls: list[str] = []
    tts_service._para_cache.clear()
    monkeypatch.setattr(tts_service, "_cache_dir", tmp_path)

    def fake_communicate(text: str, voice: str = "", **kwargs):
        calls.append(text)
        return _FakeCommunicate(text, voice, **kwargs)

    monkeypatch.setattr(tts_service.edge_tts, "Communicate", fake_communicate)

    await synthesize_paragraph("Hello world.", "us")
    assert len(calls) == 1

    tts_service._para_cache.clear()
    audio, boundaries = await synthesize_paragraph("Hello world.", "us")
    assert audio == b"ID3-fake-mp3-bytes"
    assert boundaries[-1]["offset_ms"] == 5000
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_synthesize_paragraph_empty_text_rejected(mock_edge):
    with pytest.raises(TTSUnavailableError):
        await synthesize_paragraph("   ", "us")


@pytest.mark.asyncio
async def test_synthesize_paragraph_unknown_accent_rejected(mock_edge):
    with pytest.raises(TTSUnavailableError):
        await synthesize_paragraph("Hello", "fr")


@pytest.mark.asyncio
async def test_synthesize_paragraph_failure_maps_to_error(mock_edge):
    def failing_communicate(text: str, voice: str = "", **kwargs):
        raise RuntimeError("network down")

    tts_service.edge_tts.Communicate = failing_communicate  # type: ignore[assignment]
    with pytest.raises(TTSUnavailableError):
        await synthesize_paragraph("Hello", "us")


@pytest.mark.asyncio
async def test_route_success_returns_base64_and_boundaries(monkeypatch):
    resp = await _run_route(_FakeDB(doc=_FakeDoc(), para=_FakePara()), monkeypatch)
    assert resp["audio_base64"] == base64.b64encode(b"mp3-fake").decode("ascii")
    assert resp["boundaries"][0]["offset_ms"] == 0
    assert resp["duration_ms"] == 1500  # 1000 + 500
    assert resp["accent"] == "us"


@pytest.mark.asyncio
async def test_route_doc_not_owned_returns_404(monkeypatch):
    other_user_doc = _FakeDoc()
    other_user_doc.user_id = "someone-else"
    with pytest.raises(HTTPException) as exc_info:
        await _run_route(_FakeDB(doc=other_user_doc, para=_FakePara()), monkeypatch)
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_route_missing_paragraph_returns_404(monkeypatch):
    with pytest.raises(HTTPException) as exc_info:
        await _run_route(_FakeDB(doc=_FakeDoc(), para=None), monkeypatch)
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_route_maps_failure_to_502(monkeypatch):
    async def _raise(text: str, accent: str, rate: str = "+0%"):
        raise TTSUnavailableError("boom")

    monkeypatch.setattr(tts_module, "synthesize_paragraph", _raise)
    with pytest.raises(HTTPException) as exc_info:
        await paragraph_tts(
            "11111111-1111-1111-1111-111111111111",
            index=0,
            accent="us",
            rate="+0%",
            current_user=_FakeUser(),
            db=_FakeDB(doc=_FakeDoc(), para=_FakePara()),
        )
    assert exc_info.value.status_code == 502
