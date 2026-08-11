"""TTS API — 单词发音合成（在线神经语音，edge-tts）。"""

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from app.auth.deps import get_current_user
from app.models.user import User
from app.services.tts_service import TTSUnavailableError, synthesize

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
