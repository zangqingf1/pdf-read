"""Word analysis API routes — AI-powered vocabulary lookup."""

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
from app.models.user import User
from app.models.word_analysis import WordAnalysis
from app.schemas.words import (
    WordAnalysisRequest,
    WordAnalysisResponse,
    WordAnalysisResult,
)
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



async def _persist_analyses(
    document_id: str,
    analyses: list[dict],
    db: AsyncSession,
):
    """Persist word analyses to DB. Uses upsert: same (doc_id, para_index, word)
    overwrites existing record."""
    for entry in analyses:
        para_index = entry.get("paragraph_index", 0)
        word = entry.get("word", "").strip().lower()
        if not word:
            continue

        # Check if an analysis already exists for this (document, paragraph, word) tuple
        stmt = select(WordAnalysis).where(
            WordAnalysis.document_id == document_id,
            WordAnalysis.paragraph_index == para_index,
            WordAnalysis.word == word,
        )
        result = await db.execute(stmt)
        existing = result.scalars().first()

        if existing:
            # Update existing record
            existing.phonetic = entry.get("phonetic", "")
            existing.part_of_speech = entry.get("part_of_speech", "")
            existing.definition = entry.get("definition", "")
            existing.definition_zh = entry.get("definition_zh", "")
            collocations = entry.get("collocations", [])
            existing.collocations = (
                json.dumps(collocations, ensure_ascii=False) if collocations else "[]"
            )
            existing.example_sentence = entry.get("example_sentence", "")
            cognates = entry.get("cognates", [])
            syn_ant = entry.get("synonyms_antonyms", {"synonyms": []})
            existing.cognates = (
                json.dumps(cognates, ensure_ascii=False) if cognates else "[]"
            )
            existing.synonyms_antonyms = (
                json.dumps(syn_ant, ensure_ascii=False) if syn_ant else '{"synonyms": []}'
            )
            existing.base_form = entry.get("base_form", "")
            existing.plural_form = entry.get("plural_form", "")
        else:
            # Create new record
            collocations = entry.get("collocations", [])
            cognates = entry.get("cognates", [])
            syn_ant = entry.get("synonyms_antonyms", {"synonyms": []})
            new_analysis = WordAnalysis(
                document_id=document_id,
                paragraph_index=para_index,
                word=word,
                phonetic=entry.get("phonetic", ""),
                part_of_speech=entry.get("part_of_speech", ""),
                definition=entry.get("definition", ""),
                definition_zh=entry.get("definition_zh", ""),
                collocations=json.dumps(collocations, ensure_ascii=False) if collocations else "[]",
                example_sentence=entry.get("example_sentence", ""),
                cognates=json.dumps(cognates, ensure_ascii=False) if cognates else "[]",
                synonyms_antonyms=json.dumps(syn_ant, ensure_ascii=False) if syn_ant else '{"synonyms": []}',
                base_form=entry.get("base_form", ""),
                plural_form=entry.get("plural_form", ""),
            )
            db.add(new_analysis)

    await db.commit()


@router.post("/analyze", response_model=WordAnalysisResponse)
async def analyze_words(
    request: WordAnalysisRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Analyze selected words using AI (DeepSeek).

    Accepts entries grouped by paragraph (each entry has a sentence context,
    word list, and optional existing translation). Calls AI in parallel
    batches and persists results to the database so they survive page reloads.

    Returns a list of word analyses with id fields for later deletion.
    """
    if not request.entries:
        raise HTTPException(status_code=400, detail="No words to analyze")

    # Verify document ownership if document_id is provided
    if request.document_id:
        await _verify_document_ownership(request.document_id, current_user, db)

    ai = create_ai_service(provider=request.provider or "deepseek", api_key=request.api_key)

    try:
        # Flatten entries: each entry may contain multiple words.
        # The whole paragraph text is used as AI context (no sentence splitting).
        flat_entries: list[dict] = []
        for entry in request.entries:
            for word in entry.words:
                word = word.strip()
                flat_entries.append({
                    "paragraph_index": entry.paragraph_index,
                    "word": word,
                    "sentence": entry.sentence,
                    "sentence_translation": None,  # Per-sentence translation not available
                })

        # Deduplicate: if same word+paragraph already requested, skip duplicate
        seen = set()
        unique_entries = []
        for e in flat_entries:
            key = (e["paragraph_index"], e["word"].lower())
            if key not in seen:
                seen.add(key)
                unique_entries.append(e)

        # Resolve custom prompt from DB (if set), otherwise use defaults
        system_override, user_override = await resolve_prompt_overrides(db, "analyze_words")

        # Call AI service
        raw_results = await ai.analyze_words(
            unique_entries,
            system_prompt_override=system_override,
            user_prompt_override=user_override,
        )

        # Build result list
        analyses: list[WordAnalysisResult] = []
        for r in raw_results:
            analyses.append(WordAnalysisResult(
                paragraph_index=r.get("paragraph_index", 0),
                word=r.get("word", ""),
                phonetic=r.get("phonetic", ""),
                part_of_speech=r.get("part_of_speech", ""),
                definition=r.get("definition", ""),
                definition_zh=r.get("definition_zh", ""),
                collocations=r.get("collocations", []),
                example_sentence=r.get("example_sentence", ""),
                cognates=r.get("cognates", []),
                synonyms_antonyms=r.get("synonyms_antonyms", {"synonyms": []}),
                base_form=r.get("base_form", ""),
                plural_form=r.get("plural_form", ""),
            ))

        # Persist to DB
        if request.document_id and raw_results:
            try:
                await _persist_analyses(request.document_id, raw_results, db)
            except Exception:
                _logger.exception("Failed to persist word analyses for document %s", request.document_id)

        return WordAnalysisResponse(analyses=analyses)

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
                detail=f"单词解析失败: {err_msg[:200]}",
            )
    finally:
        # Release the per-request httpx client (connection pool).
        await ai.close()


@router.post("/stream")
async def analyze_words_stream(
    request: WordAnalysisRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Analyze words with SSE streaming — results arrive progressively.

    Each completed batch of word analyses is sent as a Server-Sent Event:
    ``data: {"type": "batch", "analyses": [...]}``

    A final event signals completion:
    ``data: {"type": "done"}``

    The frontend can render each word analysis card as it arrives instead
    of waiting for the entire batch.
    """
    if not request.entries:
        raise HTTPException(status_code=400, detail="No words to analyze")

    # Verify document ownership if document_id is provided
    if request.document_id:
        await _verify_document_ownership(request.document_id, current_user, db)

    ai = create_ai_service(provider=request.provider or "deepseek", api_key=request.api_key)

    # Resolve custom prompt from DB (if set), otherwise use defaults
    system_override, user_override = await resolve_prompt_overrides(db, "analyze_words")

    # Flatten entries (same as /analyze) — full paragraph text as context
    flat_entries: list[dict] = []
    for entry in request.entries:
        for word in entry.words:
            word = word.strip()
            flat_entries.append({
                "paragraph_index": entry.paragraph_index,
                "word": word,
                "sentence": entry.sentence,
                "sentence_translation": None,
            })

    # Deduplicate
    seen = set()
    unique_entries = []
    for e in flat_entries:
        key = (e["paragraph_index"], e["word"].lower())
        if key not in seen:
            seen.add(key)
            unique_entries.append(e)

    async def event_generator():
        all_raw: list[dict] = []
        try:
            try:
                async for event in ai.analyze_words_stream(
                    unique_entries,
                    system_prompt_override=system_override,
                    user_prompt_override=user_override,
                ):
                    if event["type"] == "heartbeat":
                        # 保活心跳 — 前端据此重置读超时计时
                        yield "data: " + json.dumps({"type": "heartbeat"}) + "\n\n"
                        continue

                    if event["type"] == "chunk":
                        # Relay raw text chunk to frontend so user sees AI output in real time
                        yield (
                            "data: "
                            + json.dumps({
                                "type": "chunk",
                                "batch_id": event["batch_id"],
                                "text": event["text"],
                                "words": event["words"],
                                "para_index": event["para_index"],
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
                                "word": r.get("word", ""),
                                "phonetic": r.get("phonetic", ""),
                                "part_of_speech": r.get("part_of_speech", ""),
                                "definition": r.get("definition", ""),
                                "definition_zh": r.get("definition_zh", ""),
                                "collocations": r.get("collocations", []),
                                "example_sentence": r.get("example_sentence", ""),
                                "cognates": r.get("cognates", []),
                                "synonyms_antonyms": r.get("synonyms_antonyms", {"synonyms": []}),
                                "base_form": r.get("base_form", ""),
                                "plural_form": r.get("plural_form", ""),
                            })
                        yield (
                            "data: "
                            + json.dumps({
                                "type": "batch",
                                "analyses": batch_analyses,
                                "words": event["words"],
                                "para_index": event["para_index"],
                            }, ensure_ascii=False)
                            + "\n\n"
                        )

                    elif event["type"] == "incomplete":
                        # 部分单词补偿后仍失败/超时早退 — 透传给前端提示用户
                        yield (
                            "data: "
                            + json.dumps({
                                "type": "incomplete",
                                "words": event.get("words", []),
                            }, ensure_ascii=False)
                            + "\n\n"
                        )

                # Persist if document_id provided
                if request.document_id and all_raw:
                    try:
                        await _persist_analyses(request.document_id, all_raw, db)
                    except Exception:
                        _logger.exception("Failed to persist stream word analyses for document %s", request.document_id)

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
                    code, msg = 502, f"单词解析失败: {err_msg[:200]}"
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
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/list/{document_id}", response_model=WordAnalysisResponse)
async def get_word_analyses(
    document_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get all saved word analyses for a document.

    Used to restore word analysis results when re-opening a document.
    """
    await _verify_document_ownership(document_id, current_user, db)
    stmt = (
        select(WordAnalysis)
        .where(WordAnalysis.document_id == document_id)
        .order_by(WordAnalysis.paragraph_index, WordAnalysis.word)
    )
    result = await db.execute(stmt)
    records = result.scalars().all()

    analyses = []
    for wa in records:
        try:
            collocations = json.loads(wa.collocations) if wa.collocations else []
        except (json.JSONDecodeError, TypeError):
            collocations = []
        try:
            cognates = json.loads(wa.cognates) if wa.cognates else []
        except (json.JSONDecodeError, TypeError):
            cognates = []
        try:
            syn_ant = json.loads(wa.synonyms_antonyms) if wa.synonyms_antonyms else {"synonyms": []}
        except (json.JSONDecodeError, TypeError):
            syn_ant = {"synonyms": []}

        analyses.append(WordAnalysisResult(
            id=str(wa.id),
            paragraph_index=wa.paragraph_index,
            word=wa.word,
            phonetic=wa.phonetic or "",
            part_of_speech=wa.part_of_speech or "",
            definition=wa.definition or "",
            definition_zh=wa.definition_zh or "",
            collocations=collocations,
            example_sentence=wa.example_sentence or "",
            cognates=cognates,
            synonyms_antonyms=syn_ant,
            base_form=wa.base_form or "",
            plural_form=wa.plural_form or "",
        ))

    return WordAnalysisResponse(analyses=analyses)


@router.api_route("/document/{document_id}", methods=["DELETE", "POST"])
async def delete_all_word_analyses(
    document_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete all word analysis records for a document."""
    await _verify_document_ownership(document_id, current_user, db)
    stmt = delete(WordAnalysis).where(WordAnalysis.document_id == document_id)
    result = await db.execute(stmt)
    await db.commit()

    return {"status": "ok", "deleted": result.rowcount}


@router.delete("/{analysis_id}")
async def delete_word_analysis(
    analysis_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a single word analysis record."""
    # Verify ownership via the parent document
    stmt = select(WordAnalysis).where(WordAnalysis.id == analysis_id)
    result = await db.execute(stmt)
    wa = result.scalar_one_or_none()
    if wa is None:
        raise HTTPException(status_code=404, detail="Word analysis not found")

    await _verify_document_ownership(wa.document_id, current_user, db)

    await db.delete(wa)
    await db.commit()

    return {"status": "ok"}
