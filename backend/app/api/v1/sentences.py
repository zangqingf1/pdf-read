"""Sentence analysis API routes — AI-powered sentence 精讲 (detailed analysis)."""

import json
import logging
import uuid

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.database import get_db
from app.models.document import Document
from app.models.sentence_analysis import SentenceAnalysis
from app.models.user import User
from app.schemas.sentences import (
    SentenceAnalysisRequest,
    SentenceAnalysisResponse,
    SentenceAnalysisResult,
)
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


async def _persist_analyses(
    document_id: str,
    analyses: list[dict],
    db: AsyncSession,
):
    """Persist sentence analyses to DB. Uses upsert: same (doc_id, para_index,
    sentence_index) overwrites existing record."""
    for entry in analyses:
        para_index = entry.get("paragraph_index", 0)
        sent_index = entry.get("sentence_index", 0)
        sentence_text = entry.get("sentence_text", "")

        # Check if an analysis already exists for this tuple
        stmt = select(SentenceAnalysis).where(
            SentenceAnalysis.document_id == document_id,
            SentenceAnalysis.paragraph_index == para_index,
            SentenceAnalysis.sentence_index == sent_index,
        )
        result = await db.execute(stmt)
        existing = result.scalars().first()

        # Build the JSON to store — content is raw markdown from AI
        content = entry.get("content", "")
        structure_json = json.dumps(
            {"content": content},
            ensure_ascii=False,
        )

        if existing:
            existing.sentence_text = sentence_text
            existing.structure_json = structure_json
        else:
            new_analysis = SentenceAnalysis(
                document_id=document_id,
                paragraph_index=para_index,
                sentence_index=sent_index,
                sentence_text=sentence_text,
                structure_json=structure_json,
            )
            db.add(new_analysis)

    await db.commit()


def _serialize_analysis(record: SentenceAnalysis) -> SentenceAnalysisResult:
    """Convert a SentenceAnalysis DB record to a response model."""
    content = ""
    try:
        data = json.loads(record.structure_json) if record.structure_json else {}
    except (json.JSONDecodeError, TypeError):
        data = {}

    # New format: {"content": "..."} — raw markdown
    if "content" in data:
        content = data["content"]
    # Backward compat: old format {"structure": [...], "idiomatic_translation": "...", ...}
    # Reconstruct as markdown for display
    elif "structure" in data or "idiomatic_translation" in data:
        parts = []
        structure = data.get("structure", [])
        if structure:
            parts.append("**原文**：" + record.sentence_text)
            parts.append("")
            # Build structure summary
            structure_lines = []
            for s in structure:
                label = s.get("label", "")
                text = s.get("text", "")
                expl = s.get("explanation", "")
                structure_lines.append(f"- **{label}**：{text}（{expl}）")
            parts.append("**主干**：\n" + "\n".join(structure_lines))
            parts.append("")
        translation = data.get("idiomatic_translation", "")
        if translation:
            parts.append("**译文**：" + translation)
        gh = data.get("grammar_highlights", [])
        if gh:
            parts.append("")
            parts.append("**讲解**：")
            for h in gh:
                parts.append(f"- {h}")
        content = "\n".join(parts) if parts else ""

    return SentenceAnalysisResult(
        id=str(record.id),
        paragraph_index=record.paragraph_index,
        sentence_index=record.sentence_index,
        sentence_text=record.sentence_text or "",
        content=content,
    )


@router.post("/analyze", response_model=SentenceAnalysisResponse)
async def analyze_sentences(
    request: SentenceAnalysisRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Analyze selected sentences using AI (DeepSeek).

    Accepts a list of sentence entries (each with paragraph/sentence index,
    the sentence text, and optional paragraph-level translation for context).

    Calls AI in parallel and persists results to the database so they
    survive page reloads. Returns detailed sentence analysis (精讲) with
    原文/主干/讲解/译文 sections as markdown.
    """
    if not request.entries:
        raise HTTPException(status_code=400, detail="No sentences to analyze")

    if request.document_id:
        await _verify_document_ownership(request.document_id, current_user, db)

    ai = create_ai_service(provider=request.provider or "deepseek", api_key=request.api_key)

    try:
        # Convert Pydantic models to plain dicts for the AI service
        entries = []
        for entry in request.entries:
            entries.append({
                "paragraph_index": entry.paragraph_index,
                "sentence_index": entry.sentence_index,
                "sentence_text": entry.sentence_text,
                "sentence_translation": entry.sentence_translation,
            })

        # Call AI service
        system_override, user_override = await resolve_prompt_overrides(db, "analyze_sentences")
        raw_results = await ai.analyze_sentences(
            entries,
            system_prompt_override=system_override,
            user_prompt_override=user_override,
        )

        # Build result list
        analyses: list[SentenceAnalysisResult] = []
        for r in raw_results:
            analyses.append(SentenceAnalysisResult(
                paragraph_index=r.get("paragraph_index", 0),
                sentence_index=r.get("sentence_index", 0),
                sentence_text=r.get("sentence_text", ""),
                content=r.get("content", ""),
            ))

        # Persist to DB
        if request.document_id and raw_results:
            try:
                await _persist_analyses(request.document_id, raw_results, db)
            except Exception:
                _logger.exception("Failed to persist sentence analyses for document %s", request.document_id)

        return SentenceAnalysisResponse(analyses=analyses)

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
                detail=f"句子解析失败: {err_msg[:200]}",
            )


@router.post("/stream")
async def analyze_sentences_stream(
    request: SentenceAnalysisRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Analyze sentences with SSE streaming — results arrive progressively.

    Each completed batch of sentence analyses is sent as a Server-Sent Event:
    ``data: {"type": "batch", "analyses": [...]}``

    A final event signals completion:
    ``data: {"type": "done"}``

    The frontend can render each sentence analysis card as it arrives instead
    of waiting for the entire batch.
    """
    if not request.entries:
        raise HTTPException(status_code=400, detail="No sentences to analyze")

    if request.document_id:
        await _verify_document_ownership(request.document_id, current_user, db)

    ai = create_ai_service(provider=request.provider or "deepseek", api_key=request.api_key)

    # Convert Pydantic models to plain dicts
    entries = []
    for entry in request.entries:
        entries.append({
            "paragraph_index": entry.paragraph_index,
            "sentence_index": entry.sentence_index,
            "sentence_text": entry.sentence_text,
            "sentence_translation": entry.sentence_translation,
        })

    system_override, user_override = await resolve_prompt_overrides(db, "analyze_sentences")

    async def event_generator():
        all_raw: list[dict] = []
        try:
            async for event in ai.analyze_sentences_stream(
                entries,
                system_prompt_override=system_override,
                user_prompt_override=user_override,
            ):
                if event["type"] == "chunk":
                    # Relay raw text chunk to frontend so user sees AI output in real time
                    yield (
                        "data: "
                        + json.dumps({
                            "type": "chunk",
                            "text": event["text"],
                            "para_index": event["para_index"],
                            "sentence_index": event["sentence_index"],
                        }, ensure_ascii=False)
                        + "\n\n"
                    )

                elif event["type"] == "batch":
                    batch_results = event["results"]
                    all_raw.extend(batch_results)
                    # Build result list for this batch
                    batch_analyses = []
                    for r in batch_results:
                        batch_analyses.append({
                            "paragraph_index": r.get("paragraph_index", 0),
                            "sentence_index": r.get("sentence_index", 0),
                            "sentence_text": r.get("sentence_text", ""),
                            "content": r.get("content", ""),
                        })
                    yield (
                        "data: "
                        + json.dumps({
                            "type": "batch",
                            "analyses": batch_analyses,
                            "para_index": event["para_index"],
                            "sentence_index": event["sentence_index"],
                        }, ensure_ascii=False)
                        + "\n\n"
                    )

            # Persist if document_id provided
            if request.document_id and all_raw:
                try:
                    await _persist_analyses(request.document_id, all_raw, db)
                except Exception:
                    _logger.exception("Failed to persist stream sentence analyses for document %s", request.document_id)

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
                code, msg = 502, f"句子解析失败: {err_msg[:200]}"
            yield f"data: {json.dumps({'type': 'error', 'code': code, 'message': msg}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/list/{document_id}", response_model=SentenceAnalysisResponse)
async def get_sentence_analyses(
    document_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get all saved sentence analyses for a document.

    Used to restore sentence analysis results when re-opening a document.
    """
    await _verify_document_ownership(document_id, current_user, db)
    stmt = (
        select(SentenceAnalysis)
        .where(SentenceAnalysis.document_id == document_id)
        .order_by(SentenceAnalysis.paragraph_index, SentenceAnalysis.sentence_index)
    )
    result = await db.execute(stmt)
    records = result.scalars().all()

    analyses = [_serialize_analysis(sa) for sa in records]
    return SentenceAnalysisResponse(analyses=analyses)


@router.api_route("/document/{document_id}", methods=["DELETE", "POST"])
async def delete_all_sentence_analyses(
    document_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete all sentence analysis records for a document."""
    await _verify_document_ownership(document_id, current_user, db)
    stmt = delete(SentenceAnalysis).where(SentenceAnalysis.document_id == document_id)
    result = await db.execute(stmt)
    await db.commit()

    return {"status": "ok", "deleted": result.rowcount}


@router.delete("/{analysis_id}")
async def delete_sentence_analysis(
    analysis_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a single sentence analysis record."""
    # Verify ownership via the parent document
    stmt = select(SentenceAnalysis).where(SentenceAnalysis.id == analysis_id)
    result = await db.execute(stmt)
    sa = result.scalar_one_or_none()
    if sa is None:
        raise HTTPException(status_code=404, detail="Sentence analysis not found")

    await _verify_document_ownership(sa.document_id, current_user, db)

    await db.delete(sa)
    await db.commit()

    return {"status": "ok"}
