"""Paragraph translation API routes."""

import json
import logging
import re
import uuid

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.database import get_db
from app.models.document import Document
from app.models.paragraph import Paragraph
from app.models.user import User
from app.schemas.translate import TranslateRequest, TranslateResponse
from app.services.ai_service import create_ai_service, resolve_prompt_overrides

router = APIRouter()
_logger = logging.getLogger(__name__)


async def _verify_document_ownership(
    document_id: str, user: User, db: AsyncSession
) -> Document:
    """Verify the document exists and belongs to the current user."""
    doc = await db.get(Document, uuid.UUID(document_id))
    if doc is None or doc.user_id != user.id:
        raise HTTPException(status_code=404, detail=f"Document {document_id} not found")
    return doc


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


@router.post("", response_model=TranslateResponse)
async def translate_paragraphs(
    request: TranslateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Translate paragraphs using AI (DeepSeek).

    Accepts a list of English paragraphs and returns Chinese translations
    in the same order. Uses parallel batch processing for speed.
    If document_id is provided, saves translations to DB for future reuse.
    """
    if not request.paragraphs:
        raise HTTPException(status_code=400, detail="No paragraphs to translate")

    # Verify document ownership if document_id is provided
    if request.document_id:
        await _verify_document_ownership(request.document_id, current_user, db)

    provider = request.provider or "deepseek"
    ai = create_ai_service(provider=provider, api_key=request.api_key)

    try:
        # Clean control characters that break JSON
        paragraphs = [
            re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]", "", p)
            for p in request.paragraphs
        ]

        # Resolve custom prompt from DB (if set), otherwise use defaults
        system_override, user_override = await resolve_prompt_overrides(db, "translate")

        # translate_batch handles chunking + parallel processing internally
        translations = await ai.translate_batch(
            paragraphs,
            system_prompt_override=system_override,
            user_prompt_override=user_override,
        )

        # Persist translations if document_id is provided
        if request.document_id and translations:
            try:
                await _save_translations(request.document_id, translations, db)
            except Exception:
                _logger.exception("Failed to persist translations for document %s", request.document_id)

        return TranslateResponse(translations=translations)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        err_msg = str(e)
        if "401" in err_msg or "Unauthorized" in err_msg or "Authorization" in err_msg:
            raise HTTPException(
                status_code=401,
                detail="AI API Key 无效或未配置，请点击右上角🔑图标设置。",
            )
        elif "402" in err_msg or "insufficient" in err_msg.lower():
            raise HTTPException(
                status_code=402,
                detail="AI 账户余额不足，请检查对应平台的账户状态。",
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


@router.post("/stream")
async def translate_stream(
    request: TranslateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Translate paragraphs with SSE streaming — results arrive progressively.

    Each completed translation is sent as a Server-Sent Event:
    ``data: {"index": 0, "translation": "中文..."}``

    A final event signals completion:
    ``data: {"type": "done"}``

    The frontend can render each translation as it arrives instead of
    waiting for the entire batch.
    """
    if not request.paragraphs:
        raise HTTPException(status_code=400, detail="No paragraphs to translate")

    # Verify document ownership if document_id is provided
    if request.document_id:
        await _verify_document_ownership(request.document_id, current_user, db)

    provider = request.provider or "deepseek"
    ai = create_ai_service(provider=provider, api_key=request.api_key)

    # Clean control characters
    paragraphs = [
        re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]", "", p)
        for p in request.paragraphs
    ]

    # Resolve custom prompt from DB (if set), otherwise use defaults
    system_override, user_override = await resolve_prompt_overrides(db, "translate")

    async def event_generator():
        translations: dict[int, str] = {}
        try:
            async for index, translation in ai.translate_batch_stream(
                paragraphs,
                system_prompt_override=system_override,
                user_prompt_override=user_override,
            ):
                translations[index] = translation
                yield f"data: {json.dumps({'index': index, 'translation': translation}, ensure_ascii=False)}\n\n"

            # Persist if document_id provided
            if request.document_id and translations:
                try:
                    ordered = [
                        translations.get(i, "")
                        for i in range(len(paragraphs))
                    ]
                    await _save_translations(request.document_id, ordered, db)
                except Exception:
                    _logger.exception("Failed to persist stream translations for document %s", request.document_id)

            yield f"data: {json.dumps({'type': 'done'})}\n\n"

        except ValueError as e:
            yield f"data: {json.dumps({'type': 'error', 'code': 400, 'message': str(e)}, ensure_ascii=False)}\n\n"
        except Exception as e:
            err_msg = str(e)
            if "401" in err_msg or "Unauthorized" in err_msg:
                code, msg = 401, "AI API Key 无效或未配置，请点击右上角🔑图标设置。"
            elif "402" in err_msg or "insufficient" in err_msg.lower():
                code, msg = 402, "AI 账户余额不足，请检查对应平台的账户状态。"
            elif "429" in err_msg or "rate" in err_msg.lower():
                code, msg = 429, "API 请求过于频繁，请稍后重试。"
            elif "timeout" in err_msg.lower():
                code, msg = 504, "AI 服务响应超时，请稍后重试。"
            else:
                code, msg = 502, f"翻译失败: {err_msg[:200]}"
            yield f"data: {json.dumps({'type': 'error', 'code': code, 'message': msg}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        },
    )
