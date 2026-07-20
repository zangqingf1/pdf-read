"""F01: PDF upload and text extraction API routes."""

import json
import uuid
import asyncio
from typing import Optional

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends, BackgroundTasks
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, async_session_factory
from app.models.sentence_analysis import SentenceAnalysis
from app.models.word_analysis import WordAnalysis
from app.schemas.pdf import (
    PDFUploadResponse,
    PDFStatusResponse,
    PDFResultResponse,
    ParagraphResult,
    WordAnalysisItem,
    DocumentListResponse,
    DocumentListItem,
)
from app.services.pdf_service import pdf_service

router = APIRouter()


@router.post("/upload", response_model=PDFUploadResponse)
async def upload_pdf(
    file: UploadFile = File(...),
    mineru_token: str = Form(""),
    db: AsyncSession = Depends(get_db),
    background_tasks: BackgroundTasks = BackgroundTasks(),
):
    """Upload a PDF file for parsing.

    Validates the file (PDF format, ≤50MB), saves it, and starts
    an async parsing task. Returns a task_id for status polling.

    Request: multipart/form-data with 'file' field and optional 'mineru_token'.
    Response: {task_id, status: "processing"}
    """
    # Validate content type
    if file.content_type != "application/pdf":
        raise HTTPException(
            status_code=400,
            detail=f"Invalid content type: {file.content_type}. Only PDF is accepted.",
        )

    # Create document record and save file
    try:
        document = await pdf_service.upload_and_save(file, db)
        await db.commit()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    async def _parse_in_background(doc_id: uuid.UUID, file_path: str, token: str):
        """Parse PDF in background with its own DB session."""
        async with async_session_factory() as bg_db:
            try:
                await pdf_service.parse_document(doc_id, bg_db, mineru_token=token)
            except Exception:
                pass  # parse_document already marks status as 'failed' and flushes
            await bg_db.commit()

    task_id = str(document.id)
    try:
        from app.tasks.pdf_tasks import parse_pdf_task
        if parse_pdf_task is not None:
            parse_pdf_task.delay(
                task_id=task_id, file_path=document.file_path, mineru_token=mineru_token
            )
        else:
            background_tasks.add_task(
                _parse_in_background, document.id, document.file_path, mineru_token
            )
    except ImportError:
        background_tasks.add_task(
            _parse_in_background, document.id, document.file_path, mineru_token
        )

    return PDFUploadResponse(task_id=task_id, status="processing")


@router.get("/status/{task_id}", response_model=PDFStatusResponse)
async def get_parse_status(
    task_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get the current status of a PDF parsing task.

    Poll this endpoint to track parsing progress.
    Status transitions: pending → processing → completed / failed

    Args:
        task_id: The task_id returned from POST /upload.
    """
    document = await pdf_service.get_document(uuid.UUID(task_id), db)

    if document is None:
        raise HTTPException(status_code=404, detail=f"Document {task_id} not found")

    return PDFStatusResponse(
        task_id=task_id,
        status=document.parse_status,
        progress=100 if document.parse_status == "completed" else 50,
        error=document.error_message if document.parse_status == "failed" else None,
    )


@router.get("/result/{task_id}", response_model=PDFResultResponse)
async def get_parse_result(
    task_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get the parsed content of a completed document.

    Returns the structured paragraphs ready for display in the reader.

    Args:
        task_id: The task_id returned from POST /upload.
    """
    document = await pdf_service.get_document(uuid.UUID(task_id), db)

    if document is None:
        raise HTTPException(status_code=404, detail=f"Document {task_id} not found")

    if document.parse_status == "failed":
        raise HTTPException(status_code=422, detail="PDF parsing failed")

    if document.parse_status != "completed":
        raise HTTPException(
            status_code=425,
            detail=f"Parsing not complete. Current status: {document.parse_status}",
        )

    paragraphs = [
        ParagraphResult(index=p.index, text=p.text_en, text_zh=p.text_zh)
        for p in sorted(document.paragraphs, key=lambda p: p.index)
    ]

    # Query saved word analyses
    wa_stmt = (
        select(WordAnalysis)
        .where(WordAnalysis.document_id == task_id)
        .order_by(WordAnalysis.paragraph_index, WordAnalysis.word)
    )
    wa_result = await db.execute(wa_stmt)
    wa_records = wa_result.scalars().all()

    word_analyses = []
    for wa in wa_records:
        try:
            examples = json.loads(wa.example_sentences) if wa.example_sentences else []
        except (json.JSONDecodeError, TypeError):
            examples = []
        try:
            examples_zh = json.loads(wa.example_sentences_zh) if wa.example_sentences_zh else []
        except (json.JSONDecodeError, TypeError):
            examples_zh = []
        word_analyses.append(
            WordAnalysisItem(
                id=str(wa.id),
                paragraph_index=wa.paragraph_index,
                word=wa.word,
                phonetic=wa.phonetic or "",
                part_of_speech=wa.part_of_speech or "",
                definition=wa.definition or "",
                definition_zh=wa.definition_zh or "",
                example_sentences=examples,
                example_sentences_zh=examples_zh,
            )
        )

    # Query saved sentence analyses
    sa_stmt = (
        select(SentenceAnalysis)
        .where(SentenceAnalysis.document_id == task_id)
        .order_by(SentenceAnalysis.paragraph_index, SentenceAnalysis.sentence_index)
    )
    sa_result = await db.execute(sa_stmt)
    sa_records = sa_result.scalars().all()

    sentence_analyses = []
    for sa in sa_records:
        try:
            sa_data = json.loads(sa.structure_json) if sa.structure_json else {}
        except (json.JSONDecodeError, TypeError):
            sa_data = {}
        sentence_analyses.append({
            "id": str(sa.id),
            "paragraph_index": sa.paragraph_index,
            "sentence_index": sa.sentence_index,
            "sentence_text": sa.sentence_text or "",
            "structure": sa_data.get("structure", []),
            "idiomatic_translation": sa_data.get("idiomatic_translation", ""),
        })

    return PDFResultResponse(
        document_id=str(document.id),
        title=document.title,
        source=document.source,
        paragraphs=paragraphs,
        word_count=document.word_count or 0,
        paragraph_count=document.paragraph_count or 0,
        word_analyses=word_analyses,
        sentence_analyses=sentence_analyses,
    )


@router.get("/documents", response_model=DocumentListResponse)
async def list_documents(
    limit: int = 20,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    """List all uploaded documents, newest first.

    Args:
        limit: Max results per page (default 20).
        offset: Pagination offset.
    """
    docs, total = await pdf_service.list_documents(db, limit=limit, offset=offset)

    items = [
        DocumentListItem(
            id=str(d.id),
            title=d.title,
            source=d.source,
            word_count=d.word_count,
            parse_status=d.parse_status,
            created_at=d.created_at,
        )
        for d in docs
    ]

    return DocumentListResponse(documents=items, total=total)
