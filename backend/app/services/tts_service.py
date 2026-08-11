"""单词发音合成 — 基于微软 edge-tts 神经网络语音。

在线方案：前端优先调用本服务获取 mp3 音频；网络不可用时前端自行
回退到浏览器 Web Speech API（离线方案）。本服务只负责在线一路。

缓存三级命中：内存 → 磁盘（backend/.tts_cache/，跨重启/刷新仍命中）→ edge-tts。
"""

import hashlib
from pathlib import Path

import edge_tts

# 美音 / 英音 各选一个自然的神经音色
VOICES: dict[str, str] = {
    "us": "en-US-JennyNeural",
    "uk": "en-GB-SoniaNeural",
}

# 内存缓存：重复点击同一单词不重复联网。键 = (word, accent)
_cache: dict[tuple[str, str], bytes] = {}
_MAX_CACHE = 512

# 磁盘缓存目录：backend/.tts_cache/。测试可置 None 关闭。
_cache_dir: Path | None = Path(__file__).resolve().parent.parent.parent / ".tts_cache"


class TTSUnavailableError(Exception):
    """edge-tts 合成失败（网络不可达 / 微软服务异常）。"""


def _store_memory(key: tuple[str, str], data: bytes) -> bytes:
    if len(_cache) >= _MAX_CACHE:
        # 弹出最早一条，控制内存上限
        _cache.pop(next(iter(_cache)))
    _cache[key] = data
    return data


def _disk_path(word: str, accent: str) -> Path:
    digest = hashlib.sha1(f"{word}|{accent}".encode("utf-8")).hexdigest()
    return _cache_dir / f"{digest}.mp3"  # type: ignore[union-attr]


def _load_disk(word: str, accent: str) -> bytes | None:
    if _cache_dir is None:
        return None
    try:
        p = _disk_path(word, accent)
        return p.read_bytes() if p.exists() else None
    except OSError:
        return None


def _save_disk(word: str, accent: str, data: bytes) -> None:
    if _cache_dir is None:
        return
    try:
        _cache_dir.mkdir(parents=True, exist_ok=True)
        _disk_path(word, accent).write_bytes(data)
    except OSError:
        pass  # 磁盘不可写时静默降级，不影响内存缓存


async def synthesize(word: str, accent: str) -> bytes:
    """合成单词发音，返回 mp3 音频字节（内存 → 磁盘 → edge-tts）。"""
    voice = VOICES.get(accent)
    if voice is None:
        raise TTSUnavailableError(f"未知口音: {accent}（仅支持 us / uk）")
    if not word or not word.strip():
        raise TTSUnavailableError("单词为空")

    key = (word, accent)
    cached = _cache.get(key)
    if cached is not None:
        return cached

    disk = _load_disk(word, accent)
    if disk is not None:
        return _store_memory(key, disk)

    try:
        communicate = edge_tts.Communicate(word, voice)
        chunks: list[bytes] = []
        async for chunk in communicate.stream():
            if chunk.get("type") == "audio":
                data = chunk.get("data")
                if data:
                    chunks.append(data)
        if not chunks:
            raise TTSUnavailableError("edge-tts 未返回音频")
    except TTSUnavailableError:
        raise
    except Exception as exc:  # 网络 / 微软服务异常
        raise TTSUnavailableError(f"edge-tts 合成失败: {exc}") from exc

    data = b"".join(chunks)
    _store_memory(key, data)
    _save_disk(word, accent, data)
    return data
