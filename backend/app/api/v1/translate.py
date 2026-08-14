"""Paragraph translation API routes."""

import json
import logging
import re
import uuid

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import update
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
    try:
        doc_uuid = uuid.UUID(document_id)
    except ValueError:
        raise HTTPException(status_code=404, detail=f"Document {document_id} not found")
    doc = await db.get(Document, doc_uuid)
    if doc is None or doc.user_id != user.id:
        raise HTTPException(status_code=404, detail=f"Document {document_id} not found")
    return doc


async def _save_translations(
    document_id: str, translations: dict[int, str], db: AsyncSession
):
    """Save translations keyed by real paragraph index.

    Only non-empty texts are written; paragraphs that don't exist for this
    document are skipped silently (the UPDATE matches 0 rows).
    """
    if not translations:
        return
    doc_uuid = uuid.UUID(document_id)
    for index, text in translations.items():
        if not text or not text.strip():
            continue
        await db.execute(
            update(Paragraph)
            .where(Paragraph.document_id == doc_uuid, Paragraph.index == index)
            .values(text_zh=text)
            .execution_options(synchronize_session=False)
        )
    await db.commit()


def _map_positions_to_indices(
    request: TranslateRequest, count: int
) -> list[int]:
    """Map submitted-list positions to real paragraph indices.

    When ``request.indices`` is provided it is used positionally (so a
    translation for submitted position ``i`` lands on the paragraph whose
    real index is ``indices[i]``). When omitted, positions are treated as
    indices (legacy behavior).
    """
    if request.indices is not None:
        return request.indices
    return list(range(count))


async def _persist_translations_by_index(
    document_id: str,
    indexed: list[tuple[int, str]],
    real_indices: list[int],
    db: AsyncSession,
) -> None:
    """Build a {real_index: text} map from position-indexed results and save.

    ``indexed`` is a list of (position, text) — e.g. ``enumerate(translations)``
    or an ``ordered`` list rebuilt from a stream dict. ``real_indices[pos]`` is
    the real paragraph index for submitted position ``pos``.
    """
    index_map: dict[int, str] = {}
    for pos, text in indexed:
        if not text or not text.strip():
            continue
        index_map[real_indices[pos]] = text
    await _save_translations(document_id, index_map, db)


async def _translate_and_persist_title(
    ai,
    title: str,
    document_id: str | None,
    system_prompt_override: str | None,
    user_prompt_override: str | None,
    db: AsyncSession,
) -> str | None:
    """翻译大标题并持久化到 documents.title_zh（失败不阻断段落翻译）。"""
    try:
        clean = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]", "", title).strip()
        if not clean:
            return None
        result = await ai.translate_batch(
            [clean],
            system_prompt_override=system_prompt_override,
            user_prompt_override=user_prompt_override,
        )
        title_zh = (result[0] if result else "").strip() or None
        if title_zh and document_id:
            doc = await db.get(Document, uuid.UUID(document_id))
            if doc is not None:
                doc.title_zh = title_zh
                await db.commit()
        return title_zh
    except Exception:
        _logger.exception("Failed to translate/persist title for document %s", document_id)
        return None


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

    Optional ``title``: 大标题原文，随段落一并翻译，持久化到 documents.title_zh。
    """
    if not request.paragraphs and not request.title:
        raise HTTPException(status_code=400, detail="Nothing to translate")

    # Verify document ownership if document_id is provided
    if request.document_id:
        await _verify_document_ownership(request.document_id, current_user, db)

    # Validate indices alignment
    if request.indices is not None and len(request.indices) != len(request.paragraphs):
        raise HTTPException(
            status_code=400,
            detail="indices length must match paragraphs length",
        )

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
                real_indices = _map_positions_to_indices(request, len(paragraphs))
                await _persist_translations_by_index(
                    request.document_id,
                    list(enumerate(translations)),
                    real_indices,
                    db,
                )
            except Exception:
                _logger.exception("Failed to persist translations for document %s", request.document_id)

        # 大标题翻译：随段落一并翻译并持久化（不占 paragraphs 索引）
        title_translation: str | None = None
        if request.title and request.title.strip():
            title_translation = await _translate_and_persist_title(
                ai, request.title, request.document_id, system_override, user_override, db
            )

        return TranslateResponse(
            translations=translations, title_translation=title_translation
        )
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
    finally:
        # Release the per-request httpx client (connection pool) — otherwise
        # every AI request leaks a client + keep-alive connections.
        await ai.close()


@router.post("/stream")
async def translate_stream(
    request: TranslateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Translate paragraphs with SSE streaming — results arrive progressively.

    Each completed translation is sent as a Server-Sent Event:
    ``data: {"index": 0, "translation": "中文..."}``

    Optional ``title``: 大标题原文，翻译后先发一条
    ``data: {"type": "title", "translation": "中文..."}`` 事件并持久化到
    documents.title_zh，再开始段落流。

    A final event signals completion:
    ``data: {"type": "done"}``

    The frontend can render each translation as it arrives instead of
    waiting for the entire batch.
    """
    if not request.paragraphs and not request.title:
        raise HTTPException(status_code=400, detail="Nothing to translate")

    # Verify document ownership if document_id is provided
    if request.document_id:
        await _verify_document_ownership(request.document_id, current_user, db)

    # Validate indices alignment
    if request.indices is not None and len(request.indices) != len(request.paragraphs):
        raise HTTPException(
            status_code=400,
            detail="indices length must match paragraphs length",
        )

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
            try:
                # 大标题翻译：先出标题事件，再流式段落
                if request.title and request.title.strip():
                    title_zh = await _translate_and_persist_title(
                        ai, request.title, request.document_id,
                        system_override, user_override, db,
                    )
                    if title_zh:
                        yield f"data: {json.dumps({'type': 'title', 'translation': title_zh}, ensure_ascii=False)}\n\n"

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
                        real_indices = _map_positions_to_indices(request, len(paragraphs))
                        await _persist_translations_by_index(
                            request.document_id,
                            list(enumerate(ordered)),
                            real_indices,
                            db,
                        )
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
        finally:
            # Release the per-request httpx client even when the client
            # disconnects mid-stream (generator close triggers this finally).
            await ai.close()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        },
    )
