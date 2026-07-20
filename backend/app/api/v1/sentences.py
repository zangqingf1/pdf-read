"""Sentence analysis API routes — AI-powered sentence structure parsing."""

import json

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.sentence_analysis import SentenceAnalysis
from app.schemas.sentences import (
    SentenceAnalysisRequest,
    SentenceAnalysisResponse,
    SentenceAnalysisResult,
    StructureItem,
)
from app.services.ai_service import AIService, ai_service

router = APIRouter()


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

        # Build the JSON to store
        structure_json = json.dumps(
            {
                "structure": entry.get("structure", []),
                "idiomatic_translation": entry.get("idiomatic_translation", ""),
            },
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
    try:
        data = json.loads(record.structure_json) if record.structure_json else {}
    except (json.JSONDecodeError, TypeError):
        data = {}

    structure = [StructureItem(**s) for s in data.get("structure", [])]
    idiomatic_translation = data.get("idiomatic_translation", "")

    return SentenceAnalysisResult(
        id=str(record.id),
        paragraph_index=record.paragraph_index,
        sentence_index=record.sentence_index,
        sentence_text=record.sentence_text or "",
        structure=structure,
        idiomatic_translation=idiomatic_translation,
    )


@router.post("/analyze", response_model=SentenceAnalysisResponse)
async def analyze_sentences(
    request: SentenceAnalysisRequest,
    db: AsyncSession = Depends(get_db),
):
    """Analyze selected sentences using DeepSeek AI.

    Accepts a list of sentence entries (each with paragraph/sentence index,
    the sentence text, and optional paragraph-level translation for context).

    Calls DeepSeek in parallel and persists results to the database so they
    survive page reloads. Returns full sentence structure analysis.

    Response includes: sentence_structure (text/label/explanation arrays)
    and idiomatic Chinese translation.
    """
    if not request.entries:
        raise HTTPException(status_code=400, detail="No sentences to analyze")

    ai = ai_service
    if request.api_key:
        ai = AIService(api_key=request.api_key)

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
        raw_results = await ai.analyze_sentences(entries)

        # Build result list
        analyses: list[SentenceAnalysisResult] = []
        for r in raw_results:
            structure = [StructureItem(**s) for s in r.get("structure", [])]
            analyses.append(SentenceAnalysisResult(
                paragraph_index=r.get("paragraph_index", 0),
                sentence_index=r.get("sentence_index", 0),
                sentence_text=r.get("sentence_text", ""),
                structure=structure,
                idiomatic_translation=r.get("idiomatic_translation", ""),
            ))

        # Persist to DB
        if request.document_id and raw_results:
            try:
                await _persist_analyses(request.document_id, raw_results, db)
            except Exception:
                pass  # Persistence failure is non-fatal

        return SentenceAnalysisResponse(analyses=analyses)

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
                detail=f"句子解析失败: {err_msg[:200]}",
            )


@router.get("/list/{document_id}", response_model=SentenceAnalysisResponse)
async def get_sentence_analyses(
    document_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get all saved sentence analyses for a document.

    Used to restore sentence analysis results when re-opening a document.
    """
    stmt = (
        select(SentenceAnalysis)
        .where(SentenceAnalysis.document_id == document_id)
        .order_by(SentenceAnalysis.paragraph_index, SentenceAnalysis.sentence_index)
    )
    result = await db.execute(stmt)
    records = result.scalars().all()

    analyses = [_serialize_analysis(sa) for sa in records]
    return SentenceAnalysisResponse(analyses=analyses)


@router.delete("/{analysis_id}")
async def delete_sentence_analysis(
    analysis_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Delete a single sentence analysis record."""
    stmt = delete(SentenceAnalysis).where(SentenceAnalysis.id == analysis_id)
    result = await db.execute(stmt)
    await db.commit()

    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Sentence analysis not found")

    return {"status": "ok"}
