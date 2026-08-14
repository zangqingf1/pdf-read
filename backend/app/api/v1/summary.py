"""Full-document summary API routes.

Two endpoints:
  * ``POST /summary/stream`` — SSE stream of an AI-generated summary
    (``mode="generate"``) or an AI revision of the user's draft
    (``mode="revise"``).  The document text is loaded from the DB server-side.
  * ``PUT /summary/draft`` — persist the current textarea content (user draft
    or latest AI result) so it survives a reload.  No AI key required.
"""

import json
import logging
import uuid

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import update, select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.config import settings
from app.database import get_db
from app.models.document import Document
from app.models.paragraph import Paragraph
from app.models.user import User
from app.schemas.summary import (
    SummaryRequest,
    SummaryDraftRequest,
    SummaryDraftResponse,
)
from app.services.ai_service import create_ai_service, resolve_prompt_overrides
from app.api.v1.translate import _verify_document_ownership

router = APIRouter()
_logger = logging.getLogger(__name__)


def _truncate_document_text(text: str, max_chars: int) -> str:
    """Truncate over-long documents keeping head 60% + tail 40%.

    A summary needs both the opening (thesis) and the closing (conclusion),
    so a simple head-only cut would silently drop the article's ending.
    """
    if len(text) <= max_chars:
        return text
    marker = "\n\n[… 中间内容省略 …]\n\n"
    if max_chars <= len(marker) + 10:
        # 空间不足放不下省略标记 — 退化为纯 head 截断
        return text[:max_chars]
    total_budget = max_chars - len(marker)
    head_len = int(total_budget * 0.6)
    tail_len = total_budget - head_len
    return text[:head_len] + marker + text[-tail_len:]


async def _load_document_text(
    db: AsyncSession, document_id: str, max_chars: int
) -> str:
    """Load all English paragraphs of a document, joined in index order."""
    result = await db.execute(
        select(Paragraph.text_en)
        .where(Paragraph.document_id == uuid.UUID(document_id))
        .order_by(Paragraph.index)
    )
    joined = "\n\n".join(row[0] or "" for row in result.all())
    return _truncate_document_text(joined, max_chars)


async def _save_summary(db: AsyncSession, document_id: str, summary: str | None) -> None:
    """Persist the summary onto the documents row (None clears it)."""
    await db.execute(
        update(Document)
        .where(Document.id == uuid.UUID(document_id))
        .values(summary=summary, summary_updated_at=func.now())
        .execution_options(synchronize_session=False)
    )
    await db.commit()


@router.post("/stream")
async def summarize_document_stream(
    request: SummaryRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Stream a full-document summary (or a revision of the user's draft).

    Events:
      ``data: {"type": "chunk", "text": "..."}`` — raw text delta
      ``data: {"type": "heartbeat"}``            — keepalive while waiting
      ``data: {"type": "done", "summary": "..."}`` — final summary (persisted)
      ``data: {"type": "error", "code": ..., "message": "..."}``
    """
    if request.mode == "revise" and not (request.user_summary or "").strip():
        raise HTTPException(
            status_code=400, detail="AI 修改需要提供用户总结草稿"
        )

    # Ownership check happens before the stream starts
    await _verify_document_ownership(request.document_id, current_user, db)

    provider = request.provider or "deepseek"
    ai = create_ai_service(provider=provider, api_key=request.api_key)
    system_override, user_override = await resolve_prompt_overrides(db, "summary")

    async def event_generator():
        try:
            try:
                text = await _load_document_text(
                    db,
                    request.document_id,
                    getattr(settings, "SUMMARY_MAX_CHARS", 30000),
                )
                if not text.strip():
                    yield f"data: {json.dumps({'type': 'error', 'code': 400, 'message': '文档没有可总结的文本'}, ensure_ascii=False)}\n\n"
                    return

                async for event in ai.summarize_stream(
                    text,
                    request.user_summary if request.mode == "revise" else None,
                    system_prompt_override=system_override,
                    user_prompt_override=user_override,
                ):
                    etype = event.get("type")
                    if etype == "chunk":
                        yield f"data: {json.dumps({'type': 'chunk', 'text': event['text']}, ensure_ascii=False)}\n\n"
                    elif etype == "heartbeat":
                        yield "data: {\"type\": \"heartbeat\"}\n\n"
                    elif etype == "done":
                        summary = event.get("summary", "")
                        try:
                            await _save_summary(db, request.document_id, summary)
                        except Exception:
                            _logger.exception(
                                "Failed to persist summary for document %s",
                                request.document_id,
                            )
                        yield f"data: {json.dumps({'type': 'done', 'summary': summary}, ensure_ascii=False)}\n\n"
                        return

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
                    code, msg = 502, f"总结失败: {err_msg[:200]}"
                yield f"data: {json.dumps({'type': 'error', 'code': code, 'message': msg}, ensure_ascii=False)}\n\n"
        finally:
            # Release the per-request httpx client even on client disconnect.
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


@router.put("/draft", response_model=SummaryDraftResponse)
async def save_summary_draft(
    body: SummaryDraftRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Persist the current summary text (user draft or latest AI result).

    No AI key required — this is plain text persistence.
    An empty draft means "clear the summary" (the frontend's debounced
    auto-save never sends empty text, so this only happens via the
    explicit 清空 button).
    """
    await _verify_document_ownership(body.document_id, current_user, db)
    await _save_summary(db, body.document_id, body.summary.strip() or None)
    return SummaryDraftResponse(document_id=body.document_id)
