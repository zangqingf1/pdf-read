"""Paragraph translation API routes."""

import uuid

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.paragraph import Paragraph
from app.schemas.translate import (
    TranslateRequest,
    TranslateResponse,
    ExplainWordRequest,
    ExplainWordResponse,
    AnalyzeSentenceRequest,
    AnalyzeSentenceResponse,
)
from app.services.ai_service import AIService, ai_service

router = APIRouter()


async def _save_translations(
    document_id: str, translations: list[str], db: AsyncSession
):
    """Save translations to the paragraphs table."""
    stmt = (
        select(Paragraph)
        .where(Paragraph.document_id == uuid.UUID(document_id))
        .order_by(Paragraph.index)
    )
    result = await db.execute(stmt)
    paragraphs = result.scalars().all()

    for i, para in enumerate(paragraphs):
        if i < len(translations) and translations[i]:
            para.text_zh = translations[i]

    await db.commit()


@router.post("/translate", response_model=TranslateResponse)
async def translate_paragraphs(
    request: TranslateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Translate paragraphs using DeepSeek AI.

    Accepts a list of English paragraphs and returns Chinese translations
    in the same order. Uses batch translation for efficiency.
    If document_id is provided, saves translations to DB for future reuse.

    Args:
        request: {paragraphs: [...], api_key?: "sk-...", document_id?: "..."}
    """
    if not request.paragraphs:
        raise HTTPException(status_code=400, detail="No paragraphs to translate")

    ai = ai_service
    if request.api_key:
        ai = AIService(api_key=request.api_key)

    try:
        # Chunk large paragraph lists to avoid API token limits
        CHUNK_SIZE = 15
        # Clean control characters that break JSON
        import re
        paragraphs = [re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]', '', p) for p in request.paragraphs]
        if len(paragraphs) <= CHUNK_SIZE:
            translations = await ai.translate_batch(paragraphs)
        else:
            translations = []
            for i in range(0, len(paragraphs), CHUNK_SIZE):
                chunk = paragraphs[i : i + CHUNK_SIZE]
                chunk_translations = await ai.translate_batch(chunk)
                translations.extend(chunk_translations)

        # Persist translations if document_id is provided
        if request.document_id and translations:
            try:
                await _save_translations(request.document_id, translations, db)
            except Exception:
                pass  # Save failure is non-fatal

        return TranslateResponse(translations=translations)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        err_msg = str(e)
        if "401" in err_msg or "Unauthorized" in err_msg or "Authorization" in err_msg:
            raise HTTPException(
                status_code=401,
                detail="DeepSeek API Key 无效或未配置，请点击右上角🔑图标设置。",
            )
        elif "402" in err_msg or "insufficient" in err_msg.lower():
            raise HTTPException(
                status_code=402,
                detail="DeepSeek 账户余额不足，请前往 platform.deepseek.com 充值。",
            )
        elif "429" in err_msg or "rate" in err_msg.lower():
            raise HTTPException(
                status_code=429,
                detail="API 请求过于频繁，请稍后重试。",
            )
        elif "timeout" in err_msg.lower() or "timed out" in err_msg.lower():
            raise HTTPException(
                status_code=504,
                detail="AI 服务响应超时，请稍后重试。",
            )
        else:
            raise HTTPException(
                status_code=502,
                detail=f"翻译失败: {err_msg[:200]}",
            )


@router.post("/explain-word", response_model=ExplainWordResponse)
async def explain_words(request: ExplainWordRequest):
    """AI-powered word explanation for one or more words in context.

    Accepts a list of words and their surrounding context, returns structured
    plain-text explanations covering POS, phonetic, definition, analysis, and examples.
    """
    words = [w.strip() for w in request.words if w.strip()]
    if not words:
        raise HTTPException(status_code=400, detail="Words cannot be empty")

    ai = ai_service
    if request.api_key:
        ai = AIService(api_key=request.api_key)

    try:
        explanations = await ai.explain_words(words, request.context)
        return ExplainWordResponse(words=words, explanations=explanations)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        err_msg = str(e)
        if "401" in err_msg or "Unauthorized" in err_msg:
            raise HTTPException(
                status_code=401,
                detail="DeepSeek API Key 无效或未配置。",
            )
        elif "timeout" in err_msg.lower():
            raise HTTPException(status_code=504, detail="AI 服务响应超时。")
        else:
            raise HTTPException(
                status_code=502,
                detail=f"单词解析失败: {err_msg[:200]}",
            )


@router.post("/analyze-sentence", response_model=AnalyzeSentenceResponse)
async def analyze_sentence(request: AnalyzeSentenceRequest):
    """AI-powered sentence grammar analysis.

    Accepts an English sentence and its surrounding context, returns a
    structured grammar analysis including sentence structure breakdown,
    grammar explanation, key vocabulary, and Chinese translation.

    Args:
        request: {sentence: str, context?: str, api_key?: str}
    """
    if not request.sentence.strip():
        raise HTTPException(status_code=400, detail="Sentence cannot be empty")

    ai = ai_service
    if request.api_key:
        ai = AIService(api_key=request.api_key)

    try:
        analysis = await ai.analyze_sentence(
            request.sentence, request.context
        )
        return AnalyzeSentenceResponse(
            sentence=request.sentence, analysis=analysis
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        err_msg = str(e)
        if "401" in err_msg or "Unauthorized" in err_msg:
            raise HTTPException(
                status_code=401,
                detail="DeepSeek API Key 无效或未配置。",
            )
        elif "timeout" in err_msg.lower():
            raise HTTPException(status_code=504, detail="AI 服务响应超时。")
        else:
            raise HTTPException(
                status_code=502,
                detail=f"句子分析失败: {err_msg[:200]}",
            )
