"""Word analysis API routes — AI-powered vocabulary lookup."""

import json
import logging
import re
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
from app.services.ai_service import create_ai_service

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


def _extract_sentence(text: str, word: str) -> str:
    """Extract the sentence containing `word` from `text`.

    Two-level split: paragraph/heading breaks (``\\n{2,}``), then
    sentence-ending punctuation (``[.!?]\\s+``).  Skips markdown headings
    when the word also appears in body text.

    **Crucially**, when the best candidate is longer than 150 chars
    (e.g. a run-on PDF paragraph without punctuation) the function
    narrows to a ~200-char window around *this specific word*.  This
    guarantees each word in the same paragraph gets its own unique
    context for the AI prompt, producing distinct translations.
    """
    if not text or not word:
        return text or ""

    word_lower = word.lower()
    HEADING_RE = re.compile(r'^#{1,6}\s+', re.MULTILINE)
    SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+|(?<=[.!?][\"'])\s+")

    # ── Stage 1: split into blocks by paragraph / heading breaks ──
    blocks = re.split(r'\n{2,}', text)

    candidates: list[tuple[str, bool]] = []  # (sentence, is_heading)

    for block in blocks:
        block = block.strip()
        if not block:
            continue

        is_heading = bool(HEADING_RE.match(block)) and len(block) < 120
        clean_block = HEADING_RE.sub('', block)

        for s in SENTENCE_SPLIT.split(clean_block):
            s = s.strip()
            if s and word_lower in s.lower():
                candidates.append((s, is_heading))

        # Also check the original (with heading markers) — the word may
        # only exist in a heading line.
        if clean_block != block:
            for s in SENTENCE_SPLIT.split(block):
                s = s.strip()
                if s and word_lower in s.lower():
                    if s not in [c[0] for c in candidates]:
                        candidates.append((s, is_heading))

    # ── Pick the best candidate ──
    if candidates:
        body = [s for s, h in candidates if not h]
        best = (body or [s for s, _ in candidates])[0]
    else:
        best = ""  # signal: no sentence found

    # ── Narrow to a window if the "sentence" is too long ──
    # A real English sentence is rarely > 150 chars.  Beyond that we're
    # looking at a run-on paragraph — fall back to a per-word window so
    # every word gets a distinct AI context.
    MAX_SENTENCE = 150
    WINDOW_HALF = 100  # chars on each side of the target word

    if best and len(best) <= MAX_SENTENCE:
        return best

    # Either no sentence candidate at all, or the one we found is a
    # run-on blob.  Extract a window tightly around the target word.
    idx = text.lower().find(word_lower)
    if idx >= 0:
        start = max(0, idx - WINDOW_HALF)
        end = min(len(text), idx + len(word) + WINDOW_HALF)
        # Try not to break mid-word at the boundaries
        while start > 0 and text[start - 1] not in (' ', '\n', '\r', '\t'):
            start -= 1
        while end < len(text) and text[end] not in (' ', '\n', '\r', '\t'):
            end += 1
        return text[start:end].strip()

    return text[:200]


async def _persist_analyses(
    document_id: str,
    analyses: list[dict],
    db: AsyncSession,
):
    """Persist word analyses to DB. Uses upsert: same (doc_id, para_index, word)
    overwrites existing record."""
    for entry in analyses:
        para_index = entry.get("paragraph_index", 0)
        word = entry.get("word", "")
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
            syn_ant = entry.get("synonyms_antonyms", {"synonyms": [], "antonyms": []})
            existing.cognates = (
                json.dumps(cognates, ensure_ascii=False) if cognates else "[]"
            )
            existing.synonyms_antonyms = (
                json.dumps(syn_ant, ensure_ascii=False) if syn_ant else '{"synonyms": [], "antonyms": []}'
            )
            existing.base_form = entry.get("base_form", "")
            existing.plural_form = entry.get("plural_form", "")
        else:
            # Create new record
            collocations = entry.get("collocations", [])
            cognates = entry.get("cognates", [])
            syn_ant = entry.get("synonyms_antonyms", {"synonyms": [], "antonyms": []})
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
                synonyms_antonyms=json.dumps(syn_ant, ensure_ascii=False) if syn_ant else '{"synonyms": [], "antonyms": []}',
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
        # For each word, extract the sentence that contains it from the paragraph.
        flat_entries: list[dict] = []
        for entry in request.entries:
            for word in entry.words:
                word = word.strip()
                extracted_sentence = _extract_sentence(entry.sentence, word)
                flat_entries.append({
                    "paragraph_index": entry.paragraph_index,
                    "word": word,
                    "sentence": extracted_sentence,
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

        # Call AI service
        raw_results = await ai.analyze_words(unique_entries)

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
                synonyms_antonyms=r.get("synonyms_antonyms", {"synonyms": [], "antonyms": []}),
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

    # Flatten entries (same as /analyze)
    flat_entries: list[dict] = []
    for entry in request.entries:
        for word in entry.words:
            word = word.strip()
            extracted_sentence = _extract_sentence(entry.sentence, word)
            flat_entries.append({
                "paragraph_index": entry.paragraph_index,
                "word": word,
                "sentence": extracted_sentence,
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
            async for event in ai.analyze_words_stream(unique_entries):
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
                            "synonyms_antonyms": r.get("synonyms_antonyms", {"synonyms": [], "antonyms": []}),
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
            syn_ant = json.loads(wa.synonyms_antonyms) if wa.synonyms_antonyms else {"synonyms": [], "antonyms": []}
        except (json.JSONDecodeError, TypeError):
            syn_ant = {"synonyms": [], "antonyms": []}

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
