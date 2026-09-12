"""单词发音 / 段落朗读合成 — 基于微软 edge-tts 神经网络语音。

在线方案：前端优先调用本服务获取 mp3 音频；网络不可用时前端自行
回退到浏览器 Web Speech API（离线方案）。本服务只负责在线一路。

单词缓存三级命中：内存 → 磁盘（backend/.tts_cache/，跨重启/刷新仍命中）→ edge-tts。
段落朗读额外携带 WordBoundary 词级时间戳（100ns 单位），供前端做卡拉OK高亮。
"""

import asyncio
import hashlib
import json
import re
import threading
from pathlib import Path

import edge_tts

from app.config import settings

# 美音 / 英音 各选一个自然的神经音色
VOICES: dict[str, str] = {
    "us": "en-US-JennyNeural",
    "uk": "en-GB-SoniaNeural",
}

# 内存缓存：重复点击同一单词不重复联网。键 = (word, accent)
_cache: dict[tuple[str, str], bytes] = {}
_MAX_CACHE = 512

# 段落朗读缓存：体积较大，容量上限更小。键 = (text, accent, rate)
_para_cache: dict[tuple[str, str, str], tuple[bytes, list[dict]]] = {}
_MAX_PARA_CACHE = 16

# edge-tts 时间戳单位为 100ns（1 tick = 1e-7s），转毫秒除以 10^4。
_TICKS_TO_MS = 10_000

# rate 参数格式：如 "+10%"、"-20%"、"0%"
_RATE_RE = re.compile(r"^[+-]?\d{1,3}%$")

# 磁盘缓存目录：backend/.tts_cache/。测试可置 None 关闭。
_cache_dir: Path | None = Path(__file__).resolve().parent.parent.parent / ".tts_cache"

# 磁盘缓存总容量上限（字节），超限按 mtime 淘汰最旧文件
_CACHE_MAX_BYTES = settings.TTS_CACHE_MAX_MB * 1024 * 1024

# 磁盘缓存「目录 → 当前总字节数」的运行计数：首次写入实测一次，之后增量维护，
# 只有真正超限时才再全目录扫描淘汰。目录被替换（测试 monkeypatch）会自动重测。
_disk_state: tuple[Path, int] | None = None
_disk_lock = threading.Lock()


class TTSUnavailableError(Exception):
    """edge-tts 合成失败（网络不可达 / 微软服务异常）。"""


def _scan_disk_bytes_locked() -> int:
    """实测缓存目录总字节数（仅首次写入与超限淘汰时调用）。"""
    if _cache_dir is None or not _cache_dir.is_dir():
        return 0
    total = 0
    for p in _cache_dir.iterdir():
        if not p.is_file():
            continue
        try:
            total += p.stat().st_size
        except OSError:
            continue
    return total


def _evict_disk_cache_locked() -> int:
    """超限时删除最旧文件（mp3 与 sidecar json 成对淘汰），返回剩余字节数。

    调用方持有 ``_disk_lock``，且仅在计数超限时进入这里。
    """
    if _cache_dir is None or not _cache_dir.is_dir():
        return 0
    sized: list[tuple[float, int, Path]] = []
    total = 0
    for p in _cache_dir.iterdir():
        if not p.is_file():
            continue
        try:
            st = p.stat()
        except OSError:
            continue
        sized.append((st.st_mtime, st.st_size, p))
        total += st.st_size
    if total <= _CACHE_MAX_BYTES:
        return total
    by_path = {p: size for _, size, p in sized}
    sized.sort(key=lambda t: t[0])  # oldest first
    for _, _, p in sized:
        if total <= _CACHE_MAX_BYTES:
            break
        base = str(p)
        victims = [p]
        if base.endswith(".mp3"):
            victims.append(Path(base[: -len(".mp3")] + ".json"))
        elif base.endswith(".json"):
            victims.append(Path(base[: -len(".json")] + ".mp3"))
        for victim in victims:
            info = by_path.get(victim)
            try:
                if victim.exists():
                    victim.unlink()
            except OSError:
                continue
            if info is not None:
                total -= info
                by_path.pop(victim, None)
    return total


def _save_disk_files_locked(entries: list[tuple[Path, bytes]]) -> None:
    """写入文件并维护运行中的字节总数，仅在超限时触发一次全目录淘汰。"""
    global _disk_state
    assert _cache_dir is not None
    written = 0
    for path, data in entries:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        written += len(data)
    if _disk_state is None or _disk_state[0] != _cache_dir:
        _disk_state = (_cache_dir, _scan_disk_bytes_locked())
    else:
        _disk_state = (_cache_dir, _disk_state[1] + written)
    if _disk_state[1] > _CACHE_MAX_BYTES:
        _disk_state = (_cache_dir, _evict_disk_cache_locked())


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
        with _disk_lock:
            _save_disk_files_locked([(_disk_path(word, accent), data)])
    except OSError:
        pass  # 磁盘不可写时静默降级，不影响内存缓存


async def _load_disk_async(word: str, accent: str) -> bytes | None:
    """磁盘缓存在线程池读取：同步 read_bytes 会阻塞事件循环。"""
    if _cache_dir is None:
        return None
    return await asyncio.to_thread(_load_disk, word, accent)


async def _save_disk_async(word: str, accent: str, data: bytes) -> None:
    if _cache_dir is None:
        return
    await asyncio.to_thread(_save_disk, word, accent, data)


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

    disk = await _load_disk_async(word, accent)
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
    await _save_disk_async(word, accent, data)
    return data


# ── 段落朗读（带词级时间戳）────────────────────────────────────────

def _para_disk_path(text: str, accent: str, rate: str) -> Path:
    digest = hashlib.sha1(f"{text}|{accent}|{rate}".encode("utf-8")).hexdigest()
    return _cache_dir / f"para_{digest}"  # type: ignore[union-attr]


def _para_disk_load(text: str, accent: str, rate: str) -> tuple[bytes, list[dict]] | None:
    if _cache_dir is None:
        return None
    try:
        base = _para_disk_path(text, accent, rate)
        audio_path = Path(f"{base}.mp3")
        meta_path = Path(f"{base}.json")
        if not audio_path.exists() or not meta_path.exists():
            return None
        boundaries = json.loads(meta_path.read_text(encoding="utf-8"))
        return audio_path.read_bytes(), boundaries
    except (OSError, ValueError):
        return None


def _para_disk_save(text: str, accent: str, rate: str, audio: bytes, boundaries: list[dict]) -> None:
    if _cache_dir is None:
        return
    base = _para_disk_path(text, accent, rate)
    meta = json.dumps(boundaries, ensure_ascii=False).encode("utf-8")
    try:
        with _disk_lock:
            _save_disk_files_locked([(Path(f"{base}.mp3"), audio), (Path(f"{base}.json"), meta)])
    except OSError:
        pass  # 磁盘不可写时静默降级


async def _para_disk_load_async(text: str, accent: str, rate: str) -> tuple[bytes, list[dict]] | None:
    if _cache_dir is None:
        return None
    return await asyncio.to_thread(_para_disk_load, text, accent, rate)


async def _para_disk_save_async(
    text: str, accent: str, rate: str, audio: bytes, boundaries: list[dict]
) -> None:
    if _cache_dir is None:
        return
    await asyncio.to_thread(_para_disk_save, text, accent, rate, audio, boundaries)


def validate_rate(rate: str) -> str:
    """校验并规范化语速参数。

    edge-tts 要求 rate 必须带正负号（`^[+-]\\d+%$`，`0%` 会被拒绝），
    这里统一补全：`0%`/`10%` → `+0%`/`+10%`；非法值回退默认 `+0%`。
    """
    if not rate:
        return "+0%"
    rate = rate.strip()
    if not _RATE_RE.match(rate):
        return "+0%"
    return rate if rate[0] in "+-" else f"+{rate}"


async def synthesize_paragraph(
    text: str, accent: str, rate: str = "+0%"
) -> tuple[bytes, list[dict]]:
    """合成整段朗读音频并返回词级时间戳。

    返回 ``(mp3_bytes, boundaries)``，其中每个 boundary 为
    ``{"text": str, "offset_ms": int, "duration_ms": int}``。
    缓存三级命中：内存 → 磁盘（.tts_cache/para_*.mp3 + *.json）→ edge-tts。
    """
    voice = VOICES.get(accent)
    if voice is None:
        raise TTSUnavailableError(f"未知口音: {accent}（仅支持 us / uk）")
    if not text or not text.strip():
        raise TTSUnavailableError("段落文本为空")
    rate = validate_rate(rate)

    key = (text, accent, rate)
    cached = _para_cache.get(key)
    if cached is not None:
        return cached

    disk = await _para_disk_load_async(text, accent, rate)
    if disk is not None:
        if len(_para_cache) >= _MAX_PARA_CACHE:
            _para_cache.pop(next(iter(_para_cache)))
        _para_cache[key] = disk
        return disk

    chunks: list[bytes] = []
    boundaries: list[dict] = []
    try:
        communicate = edge_tts.Communicate(
            text, voice, rate=rate, boundary="WordBoundary"
        )
        async for chunk in communicate.stream():
            if chunk.get("type") == "audio":
                data = chunk.get("data")
                if data:
                    chunks.append(data)
            elif chunk.get("type") == "WordBoundary":
                offset = chunk.get("offset") or 0
                duration = chunk.get("duration") or 0
                boundaries.append(
                    {
                        "text": chunk.get("text") or "",
                        "offset_ms": int(offset) // _TICKS_TO_MS,
                        "duration_ms": int(duration) // _TICKS_TO_MS,
                    }
                )
        if not chunks:
            raise TTSUnavailableError("edge-tts 未返回音频")
    except TTSUnavailableError:
        raise
    except Exception as exc:  # 网络 / 微软服务异常
        raise TTSUnavailableError(f"edge-tts 段落合成失败: {exc}") from exc

    audio = b"".join(chunks)
    result = (audio, boundaries)
    if len(_para_cache) >= _MAX_PARA_CACHE:
        _para_cache.pop(next(iter(_para_cache)))
    _para_cache[key] = result
    await _para_disk_save_async(text, accent, rate, audio, boundaries)
    return result
