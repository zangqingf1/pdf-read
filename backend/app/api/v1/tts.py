"""TTS API — 单词发音 / 段落朗读合成（在线神经语音，edge-tts）。"""

import base64
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from app.auth.deps import get_current_user
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


@router.get("", response_class=Response)
async def word_tts(
    word: str = Query(..., min_length=1, max_length=200, description="要发音的单词"),
    accent: str = Query("us", pattern="^(us|uk)$", description="口音：us=美音, uk=英音"),
    current_user: User = Depends(get_current_user),
):
    """返回单词发音的 mp3 音频（edge-tts 神经语音）。

    前端在无网络/网络差时自行回退到浏览器 Web Speech API，本接口只管在线一路。
    """
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

    from sqlalchemy import select

    result = await db.execute(
        select(Paragraph).where(
            Paragraph.document_id == doc_uuid, Paragraph.index == index
        )
    )
    para = result.scalar_one_or_none()
    if para is None:
        raise HTTPException(status_code=404, detail=f"Paragraph {index} not found")

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
