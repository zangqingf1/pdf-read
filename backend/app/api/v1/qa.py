"""Document Q&A chat API routes.

Three endpoints:
  * ``POST /qa/stream`` — SSE stream of an AI answer to a question about the
    document.  The conversation history and document text are loaded from the
    DB server-side; both the user turn and the assistant reply are persisted
    when the stream completes.
  * ``GET  /qa/messages/{document_id}`` — reload a saved conversation.
  * ``DELETE /qa/messages/{document_id}`` — clear the conversation.

Events (same convention as ``/summary/stream``):
  ``data: {"type": "chunk", "text": "..."}``
  ``data: {"type": "heartbeat"}``
  ``data: {"type": "done", "user_message_id": ..., "assistant_message_id": ...}``
  ``data: {"type": "error", "code": ..., "message": "..."}`
"""

import json
import logging
import uuid

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.api.deps import ai_rate_limit
from app.config import settings
from app.database import get_db
from app.models.document import Document
from app.models.paragraph import Paragraph
from app.models.qa_message import QaMessage
from app.models.user import User
from app.schemas.qa import (
    QaStreamRequest,
    QaMessagesResponse,
    QaMessageOut,
    QaClearResponse,
)
from app.services.ai_service import (
    _SafeDict,
    create_ai_service,
    resolve_prompt_overrides,
)
from app.services.prompt_defaults import DEFAULT_PROMPTS
from app.api.v1.summary import _load_document_text
from app.api.v1.translate import _verify_document_ownership

router = APIRouter()
_logger = logging.getLogger(__name__)


async def _load_paragraph_context(
    db: AsyncSession, document_id: str, paragraph_index: int
) -> str:
    """Load the target paragraph plus its immediate neighbours as QA context."""
    result = await db.execute(
        select(Paragraph.index, Paragraph.text_en)
        .where(
            Paragraph.document_id == uuid.UUID(document_id),
            Paragraph.index >= paragraph_index - 1,
            Paragraph.index <= paragraph_index + 1,
        )
        .order_by(Paragraph.index)
    )
    rows = result.all()
    if not rows:
        return ""
    parts = []
    for idx, text in rows:
        if text is None:
            continue
        label = "目标句所在段落" if idx == paragraph_index else f"相邻段落 ({idx})"
        parts.append(f"[{label}]\n{text}")
    return "\n\n".join(parts)


def _build_chat_messages(
    request: QaStreamRequest,
    system_override: str | None,
    user_override: str | None,
    document_title: str,
    document_text: str,
    target_sentence: str,
    paragraph_context: str,
    history: list[QaMessage],
) -> list[dict[str, str]]:
    """Assemble the multi-turn messages list for the QA chat request.

    The system prompt carries the document context (placeholders formatted
    here — unlike ``_resolve_prompt`` which only formats the user template);
    the persisted history is replayed in order; the current question closes
    the list.
    """
    defaults = DEFAULT_PROMPTS[request.prompt_name]
    context_kwargs = {
        "document_title": document_title or "（无标题）",
        "document_text": document_text,
        "target_sentence": target_sentence or "（无）",
        "paragraph_context": paragraph_context or "（无）",
    }
    system_template = (
        system_override if system_override is not None else defaults["system_prompt"]
    )
    system_prompt = system_template.format_map(_SafeDict(context_kwargs))

    user_template = (
        user_override if user_override is not None else defaults["user_prompt"]
    )
    question = user_template.format_map(_SafeDict({"question": request.question}))

    # 引用句必须与问题同一条消息送达模型。默认 doc_qa 模板已把
    # {target_sentence}/{paragraph_context} 放进 system，但 doc_quiz 模板以及
    # 用户自定义的 doc_qa 模板未必包含这两个占位符——一旦缺少，选中的句子
    # 会被静默丢弃，模型收不到引用句就会回复「找不到你引用的句子」。
    # 这里无条件把引用句+所在段落上下文追加到用户消息末尾，保证送达，
    # 同时也能兜住超长文档截断（head60+tail40）把目标段落裁掉的情况。
    if target_sentence:
        quote_block = f"用户引用了一句原文，请针对该句作答：\n\n「{target_sentence}」"
        if paragraph_context:
            quote_block += f"\n\n--- 引用句所在段落及上下文 ---\n{paragraph_context}"
        question = f"{question}\n\n{quote_block}"

    messages: list[dict[str, str]] = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    for row in history:
        if row.role in ("user", "assistant") and row.content:
            messages.append({"role": row.role, "content": row.content})
    messages.append({"role": "user", "content": question})
    return messages


@router.post("/stream")
async def qa_stream(
    request: QaStreamRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _rate_limit: None = Depends(ai_rate_limit),
):
    """Stream an AI answer for one QA turn (conversation persisted server-side)."""
    if not request.question.strip():
        raise HTTPException(status_code=400, detail="问题不能为空")

    # Ownership check happens before the stream starts
    await _verify_document_ownership(request.document_id, current_user, db)

    provider = request.provider or "deepseek"
    ai = create_ai_service(provider=provider, api_key=request.api_key)
    system_override, user_override = await resolve_prompt_overrides(
        db, request.prompt_name
    )

    # 结束请求级读事务：SSE 期间不再持有 DB 事务（读上下文/写消息都在流内短时完成）。
    await db.commit()

    async def event_generator():
        try:
            try:
                # 1. Conversation history (most recent N, replayed in order)
                result = await db.execute(
                    select(QaMessage)
                    .where(QaMessage.document_id == uuid.UUID(request.document_id))
                    .order_by(QaMessage.id.desc())
                    .limit(settings.QA_HISTORY_MESSAGES)
                )
                history = list(reversed(result.scalars().all()))

                # 2. Document title + full text (head 60% + tail 40% truncation)
                title_result = await db.execute(
                    select(Document.title).where(
                        Document.id == uuid.UUID(request.document_id)
                    )
                )
                document_title = title_result.scalar_one_or_none() or ""
                document_text = await _load_document_text(
                    db, request.document_id, settings.QA_MAX_CHARS
                )
                if not document_text.strip():
                    yield f"data: {json.dumps({'type': 'error', 'code': 400, 'message': '文档没有可用于问答的文本'}, ensure_ascii=False)}\n\n"
                    return

                # 3. Target sentence + surrounding paragraphs (optional quote)
                target_sentence = (request.target_sentence or "").strip()
                paragraph_context = ""
                if request.target_paragraph_index is not None:
                    paragraph_context = await _load_paragraph_context(
                        db, request.document_id, request.target_paragraph_index
                    )

                messages = _build_chat_messages(
                    request,
                    system_override,
                    user_override,
                    document_title,
                    document_text,
                    target_sentence,
                    paragraph_context,
                    history,
                )

                answer_parts: list[str] = []
                async for event in ai.chat_stream(messages):
                    etype = event.get("type")
                    if etype == "chunk":
                        answer_parts.append(event["text"])
                        yield f"data: {json.dumps({'type': 'chunk', 'text': event['text']}, ensure_ascii=False)}\n\n"
                    elif etype == "heartbeat":
                        yield "data: {\"type\": \"heartbeat\"}\n\n"
                    elif etype == "done":
                        answer = (event.get("text") or "").strip() or "\n".join(
                            answer_parts
                        ).strip()
                        # Persist both turns only after a clean finish so an
                        # interrupted stream never leaves an orphan user row.
                        doc_uuid = uuid.UUID(request.document_id)
                        user_row = QaMessage(
                            document_id=doc_uuid,
                            role="user",
                            content=request.question.strip(),
                            paragraph_index=request.target_paragraph_index,
                            sentence_index=request.target_sentence_index,
                            sentence_text=(
                                request.target_sentence.strip()
                                if request.target_sentence
                                else None
                            ),
                        )
                        assistant_row = QaMessage(
                            document_id=doc_uuid,
                            role="assistant",
                            content=answer,
                            prompt_name=request.prompt_name,
                        )
                        db.add_all([user_row, assistant_row])
                        try:
                            await db.commit()
                        except Exception:
                            _logger.exception(
                                "Failed to persist QA messages for document %s",
                                request.document_id,
                            )
                            await db.rollback()
                        yield f"data: {json.dumps({'type': 'done', 'user_message_id': user_row.id, 'assistant_message_id': assistant_row.id}, ensure_ascii=False)}\n\n"
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
                    code, msg = 502, f"回答失败: {err_msg[:200]}"
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


@router.get("/messages/{document_id}", response_model=QaMessagesResponse)
async def list_qa_messages(
    document_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Load the saved conversation for a document (oldest first)."""
    await _verify_document_ownership(document_id, current_user, db)
    result = await db.execute(
        select(QaMessage)
        .where(QaMessage.document_id == uuid.UUID(document_id))
        .order_by(QaMessage.id)
    )
    rows = result.scalars().all()
    return QaMessagesResponse(
        document_id=document_id,
        messages=[
            QaMessageOut(
                id=row.id,
                role=row.role,
                content=row.content,
                prompt_name=row.prompt_name,
                paragraph_index=row.paragraph_index,
                sentence_index=row.sentence_index,
                sentence_text=row.sentence_text,
                created_at=row.created_at.isoformat() if row.created_at else "",
            )
            for row in rows
        ],
    )


@router.delete("/messages/{document_id}", response_model=QaClearResponse)
async def clear_qa_messages(
    document_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete the whole conversation for a document."""
    await _verify_document_ownership(document_id, current_user, db)
    result = await db.execute(
        delete(QaMessage).where(QaMessage.document_id == uuid.UUID(document_id))
    )
    await db.commit()
    return QaClearResponse(document_id=document_id, deleted=result.rowcount or 0)
