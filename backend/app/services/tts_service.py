"""单词发音 / 段落朗读合成 — 基于微软 edge-tts 神经网络语音。

在线方案：前端优先调用本服务获取 mp3 音频；网络不可用时前端自行
回退到浏览器 Web Speech API（离线方案）。本服务只负责在线一路。

单词缓存三级命中：内存 → 磁盘（backend/.tts_cache/，跨重启/刷新仍命中）→ edge-tts。
段落朗读额外携带 WordBoundary 词级时间戳（100ns 单位），供前端做卡拉OK高亮。
"""

import hashlib
import json
import re
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


class TTSUnavailableError(Exception):
    """edge-tts 合成失败（网络不可达 / 微软服务异常）。"""


def _evict_disk_cache_if_needed() -> None:
    """Keep the disk cache directory under TTS_CACHE_MAX_MB.

    Best-effort: walks all files and deletes oldest-mtime entries (mp3 与其
    sidecar json 成对淘汰) until total size fits. Silent on any OSError.
    """
    if _cache_dir is None or not _cache_dir.is_dir():
        return
    try:
        sized = []
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
            return
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
    except OSError:
        pass


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
        _evict_disk_cache_if_needed()
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
    try:
        _cache_dir.mkdir(parents=True, exist_ok=True)
        _evict_disk_cache_if_needed()
        base = _para_disk_path(text, accent, rate)
        Path(f"{base}.mp3").write_bytes(audio)
        Path(f"{base}.json").write_text(
            json.dumps(boundaries, ensure_ascii=False), encoding="utf-8"
        )
    except OSError:
        pass  # 磁盘不可写时静默降级


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

    disk = _para_disk_load(text, accent, rate)
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
    _para_disk_save(text, accent, rate, audio, boundaries)
    return result
