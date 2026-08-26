"""TTS API — 单词发音 / 段落朗读合成（在线神经语音，edge-tts）。

每用户进程内令牌桶限流（TTS_RATE_LIMIT_PER_MIN，默认 60 次/分钟），
防止第三方 TTS 服务配额被滥用。
"""

import base64
import time
import uuid
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import select

from app.auth.deps import get_current_user
from app.config import settings
from app.database import get_db
from app.models.document import Document
from app.models.paragraph import Paragraph
from app.models.user import User
from app.services.tts_service import (
    TTSUnavailableError,
    synthesize,
    synthesize_paragraph,
)

router = APIRouter()

# user_id -> deque of request timestamps (epoch seconds)
_tts_requests: dict[str, deque[float]] = defaultdict(deque)
_WINDOW_SECONDS = 60.0


def _check_user_rate_limit(user_id: str) -> None:
    """Raise 429 when the user exceeds the per-minute TTS quota."""
    now = time.time()
    q = _tts_requests[user_id]
    while q and now - q[0] > _WINDOW_SECONDS:
        q.popleft()
    if len(q) >= settings.TTS_RATE_LIMIT_PER_MIN:
        retry_in = max(1, int(q[0] + _WINDOW_SECONDS - now))
        raise HTTPException(
            status_code=429,
            detail=f"语音合成请求过于频繁，请 {retry_in} 秒后重试。",
        )
    q.append(now)
    # Opportunistic cleanup so the dict doesn't grow unbounded.
    if len(_tts_requests) > 10000:
        for uid in list(_tts_requests.keys()):
            bucket = _tts_requests.get(uid)
            if not bucket or now - bucket[-1] > _WINDOW_SECONDS:
                _tts_requests.pop(uid, None)


@router.get("", response_class=Response)
async def word_tts(
    word: str = Query(..., min_length=1, max_length=200, description="要发音的单词"),
    accent: str = Query("us", pattern="^(us|uk)$", description="口音：us=美音, uk=英音"),
    current_user: User = Depends(get_current_user),
):
    """返回单词发音的 mp3 音频（edge-tts 神经语音）。

    前端在无网络/网络差时自行回退到浏览器 Web Speech API，本接口只管在线一路。
    """
    _check_user_rate_limit(str(current_user.id))
    try:
        audio = await synthesize(word, accent)
    except TTSUnavailableError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-store"},
    )


@router.get("/paragraph/{document_id}")
async def paragraph_tts(
    document_id: str,
    index: int = Query(..., ge=0, description="段落索引"),
    accent: str = Query("us", pattern="^(us|uk)$", description="口音：us=美音, uk=英音"),
    rate: str = Query("+0%", max_length=10, description="语速：如 +10%、-20%、0%"),
    current_user: User = Depends(get_current_user),
    db=Depends(get_db),
):
    """合成某段落朗读音频并返回词级时间戳（供前端卡拉OK高亮）。

    返回 ``{"audio_base64", "boundaries": [{text, offset_ms, duration_ms}], "duration_ms"}``。
    按 ``(document_id, index)`` 读取原文，校验文档归属；失败映射 502。
    """
    try:
        doc_uuid = uuid.UUID(document_id)
    except ValueError:
        raise HTTPException(status_code=404, detail=f"Document {document_id} not found")

    doc = await db.get(Document, doc_uuid)
    if doc is None or doc.user_id != current_user.id:
        raise HTTPException(status_code=404, detail=f"Document {document_id} not found")

    result = await db.execute(
        select(Paragraph).where(
            Paragraph.document_id == doc_uuid, Paragraph.index == index
        )
    )
    para = result.scalar_one_or_none()
    if para is None:
        raise HTTPException(status_code=404, detail=f"Paragraph {index} not found")

    _check_user_rate_limit(str(current_user.id))
    try:
        audio, boundaries = await synthesize_paragraph(para.text_en, accent, rate)
    except TTSUnavailableError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    duration_ms = (
        boundaries[-1]["offset_ms"] + boundaries[-1]["duration_ms"]
        if boundaries
        else 0
    )
    return {
        "audio_base64": base64.b64encode(audio).decode("ascii"),
        "boundaries": boundaries,
        "duration_ms": duration_ms,
        "accent": accent,
        "rate": rate,
    }
