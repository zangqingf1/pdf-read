"""F01: PDF upload and text extraction API routes."""

import asyncio
import json
import logging
import mimetypes
import os
import uuid

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends, BackgroundTasks
from fastapi.responses import FileResponse, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.database import get_db, async_session_factory
from app.models.document import Document
from app.models.paragraph import Paragraph
from app.models.sentence_analysis import SentenceAnalysis
from app.models.user import User
from app.models.word_analysis import WordAnalysis
from app.schemas.pdf import (
    BatchDeleteRequest,
    BatchDeleteResponse,
    PDFUploadResponse,
    PDFStatusResponse,
    PDFResultResponse,
    ParagraphResult,
    WordAnalysisItem,
    DocumentListResponse,
    DocumentListItem,
    ParseUrlRequest,
    SelectPagesRequest,
    SelectPagesResponse,
    RetryDocumentRequest,
    PDFExportRequest,
    UpdateTitleRequest,
    UpdateTitleResponse,
    UpdateParagraphsRequest,
    UpdateParagraphsResponse,
    DeleteParagraphResponse,
    MergeParagraphsRequest,
    MergeParagraphsResponse,
    ReorderParagraphsRequest,
    ReorderParagraphsResponse,
)
from app.config import settings
from app.services.pdf_service import pdf_service
from app.services.export_service import (
    ChromeRenderError,
    ChromeTimeoutError,
    ChromeUnavailableError,
    pdf_render_semaphore,
    render_html_to_pdf,
)

router = APIRouter()


async def _get_owned_document(
    task_id: str, user: User, db: AsyncSession
) -> Document:
    """Fetch a document by ID, verifying it belongs to the current user.

    Returns the document or raises 404 (not found / not owned).
    Using 404 instead of 403 to avoid leaking document existence info.
    """
    document = await pdf_service.get_document(
        uuid.UUID(task_id), db, user_id=user.id
    )
    if document is None:
        raise HTTPException(status_code=404, detail=f"Document {task_id} not found")
    return document


_logger = logging.getLogger(__name__)


async def _parse_in_background(doc_id: uuid.UUID, file_path: str, token: str):
    """Background task: parse a PDF document in a separate DB session."""
    async with async_session_factory() as bg_db:
        try:
            await pdf_service.parse_document(doc_id, bg_db, mineru_token=token)
        except Exception:
            _logger.exception("Background parse failed for document %s", doc_id)
        await bg_db.commit()


@router.post("/upload", response_model=PDFUploadResponse)
async def upload_pdf(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    mineru_token: str = Form(""),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload a document file for parsing (any MinerU-supported type).

    Validates the file (whitelist extension, ≤50MB), saves it, and starts
    an async parsing task. Returns a task_id for status polling.

    PDF files go through page selection (awaiting_selection); other file
    types parse immediately.

    Request: multipart/form-data with 'file' field and optional 'mineru_token'.
    Response: {task_id, status, page_count, source_type, file_ext}
    """
    # Create document record and save file (file-type whitelist is validated
    # inside pdf_service.upload_and_save)
    try:
        document = await pdf_service.upload_and_save(
            file, db, user_id=current_user.id
        )
        await db.commit()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    task_id = str(document.id)

    # If page count is available, always let user select pages first (PDF only)
    if document.page_count is not None and document.page_count >= 1:
        document.parse_status = "awaiting_selection"
        await db.commit()
        return PDFUploadResponse(
            task_id=task_id,
            status="awaiting_selection",
            page_count=document.page_count,
            source_type=document.source_type,
            file_ext=document.file_ext,
        )

    # Unknown page count (non-PDF files): parse immediately
    background_tasks.add_task(
        _parse_in_background, document.id, document.file_path, mineru_token
    )

    return PDFUploadResponse(
        task_id=task_id,
        status="processing",
        page_count=document.page_count,
        source_type=document.source_type,
        file_ext=document.file_ext,
    )


@router.post("/parse-url", response_model=PDFUploadResponse)
async def parse_url_document(
    background_tasks: BackgroundTasks,
    body: ParseUrlRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Parse a URL — a file link (.pdf/.docx/image…) or an HTML web page.

    The server downloads a copy (file-type URLs are parsed via the MinerU
    batch flow; HTML pages via MinerU-HTML server-side fetch) and returns a
    task_id for status polling. URL sources always skip page selection.
    """
    try:
        document = await pdf_service.save_url_document(
            body.url, db, user_id=current_user.id
        )
        await db.commit()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    background_tasks.add_task(
        _parse_in_background, document.id, document.file_path or "", body.mineru_token
    )

    return PDFUploadResponse(
        task_id=str(document.id),
        status="processing",
        page_count=None,
        source_type=document.source_type,
        file_ext=document.file_ext,
    )


@router.get("/status/{task_id}", response_model=PDFStatusResponse)
async def get_parse_status(
    task_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the current status of a PDF parsing task.

    Poll this endpoint to track parsing progress.
    Status transitions: pending → processing → completed / failed

    Args:
        task_id: The task_id returned from POST /upload.
    """
    document = await _get_owned_document(task_id, current_user, db)

    return PDFStatusResponse(
        task_id=task_id,
        status=document.parse_status,
        progress=100 if document.parse_status == "completed" else 50,
        error=document.error_message if document.parse_status == "failed" else None,
        page_count=document.page_count,
        selected_pages=document.selected_pages,
        source_type=document.source_type,
        file_ext=document.file_ext,
    )


@router.get("/result/{task_id}", response_model=PDFResultResponse)
async def get_parse_result(
    task_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the parsed content of a completed document.

    Returns the structured paragraphs ready for display in the reader.

    Args:
        task_id: The task_id returned from POST /upload.
    """
    document = await _get_owned_document(task_id, current_user, db)

    if document.parse_status == "failed":
        raise HTTPException(status_code=422, detail="PDF parsing failed")

    if document.parse_status != "completed":
        raise HTTPException(
            status_code=425,
            detail=f"Parsing not complete. Current status: {document.parse_status}",
        )

    paragraphs = [
        ParagraphResult(
            index=p.index,
            text=p.text_en,
            text_zh=p.text_zh,
            page_number=p.page_number,
        )
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
        word_analyses.append(
            WordAnalysisItem(
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
        # New format: {"content": "..."}
        content = sa_data.get("content", "")
        # Backward compat: reconstruct from old format
        if not content and ("structure" in sa_data or "idiomatic_translation" in sa_data):
            parts = []
            structure = sa_data.get("structure", [])
            if structure:
                parts.append("**原文**：" + (sa.sentence_text or ""))
                parts.append("")
                structure_lines = []
                for s in structure:
                    label = s.get("label", "")
                    text = s.get("text", "")
                    expl = s.get("explanation", "")
                    structure_lines.append(f"- **{label}**：{text}（{expl}）")
                parts.append("**主干**：\n" + "\n".join(structure_lines))
                parts.append("")
            translation = sa_data.get("idiomatic_translation", "")
            if translation:
                parts.append("**译文**：" + translation)
            gh = sa_data.get("grammar_highlights", [])
            if gh:
                parts.append("")
                parts.append("**讲解**：")
                for h in gh:
                    parts.append(f"- {h}")
            content = "\n".join(parts) if parts else ""
        sentence_analyses.append({
            "id": str(sa.id),
            "paragraph_index": sa.paragraph_index,
            "sentence_index": sa.sentence_index,
            "sentence_text": sa.sentence_text or "",
            "content": content,
        })

    return PDFResultResponse(
        document_id=str(document.id),
        title=document.title,
        title_zh=document.title_zh,
        source=document.source,
        paragraphs=paragraphs,
        word_count=document.word_count or 0,
        paragraph_count=document.paragraph_count or 0,
        word_analyses=word_analyses,
        sentence_analyses=sentence_analyses,
        page_count=document.page_count,
        selected_pages=document.selected_pages,
        source_type=document.source_type,
        file_ext=document.file_ext,
        summary=document.summary,
        summary_updated_at=document.summary_updated_at,
    )


@router.get("/file/{task_id}")
async def get_pdf_file(
    task_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Serve the original source file for client-side preview rendering.

    Used by the PageSelector component (PDF via react-pdf/PDF.js).
    """
    document = await _get_owned_document(task_id, current_user, db)

    file_path = document.file_path
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="源文件不存在")

    media_type = mimetypes.guess_type(file_path)[0] or "application/octet-stream"
    return FileResponse(file_path, media_type=media_type)


@router.put("/documents/{task_id}/title", response_model=UpdateTitleResponse)
async def update_document_title(
    task_id: str,
    body: UpdateTitleRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """修改文档大标题。

    阅读页点击标题即可编辑。英文标题变更后清空旧的中文翻译
    （与段落编辑一致：英文变更使翻译失效，重进阅读页随翻译流程自动重译）。

    Args:
        task_id: Document UUID.
        body: {title} — 新标题（1–500 字符）。
    """
    document = await _get_owned_document(task_id, current_user, db)

    new_title = body.title.strip()
    if not new_title:
        raise HTTPException(status_code=400, detail="标题不能为空")

    document.title = new_title
    document.title_zh = None  # 旧中文翻译失效，随翻译流程重译
    await db.commit()

    return UpdateTitleResponse(
        document_id=task_id,
        title=document.title,
        title_zh=document.title_zh,
    )


@router.put("/documents/{task_id}/paragraphs", response_model=UpdateParagraphsResponse)
async def update_paragraphs(
    task_id: str,
    body: UpdateParagraphsRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Batch update paragraph text for a document.

    Used by the review/edit page to persist user corrections to OCR text.
    If English text changes, the Chinese translation is cleared so it will
    be re-translated when the user enters the reader.

    Args:
        task_id: Document UUID.
        body: List of {index, text_en} pairs to update.
    """
    document = await _get_owned_document(task_id, current_user, db)

    if document.parse_status != "completed":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot edit paragraphs for a document with status '{document.parse_status}'",
        )

    # Build a lookup of existing paragraphs by index
    para_map = {p.index: p for p in document.paragraphs}

    updated_count = 0
    for item in body.paragraphs:
        para = para_map.get(item.index)
        if para is None:
            continue  # Skip non-existent indices silently

        if para.text_en != item.text_en:
            para.text_en = item.text_en
            para.text_zh = None  # Invalidate stale translation
            updated_count += 1

    if updated_count > 0:
        # Recalculate document-level aggregates
        all_paragraphs = sorted(document.paragraphs, key=lambda p: p.index)
        document.original_text = "\n\n".join(p.text_en for p in all_paragraphs)
        document.word_count = sum(
            len(p.text_en.split()) for p in all_paragraphs
        )

    await db.commit()

    return UpdateParagraphsResponse(
        document_id=task_id,
        updated_count=updated_count,
    )


@router.delete(
    "/documents/{task_id}/paragraphs/{paragraph_index}",
    response_model=DeleteParagraphResponse,
)
async def delete_paragraph(
    task_id: str,
    paragraph_index: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a single paragraph from a document.

    Removes the paragraph at the given index and re-indexes all
    subsequent paragraphs to keep indices contiguous.
    """
    document = await _get_owned_document(task_id, current_user, db)

    if document.parse_status != "completed":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot edit paragraphs for a document with status '{document.parse_status}'",
        )

    # Find the paragraph by index
    target = next(
        (p for p in document.paragraphs if p.index == paragraph_index), None
    )
    if target is None:
        raise HTTPException(
            status_code=404,
            detail=f"Paragraph index {paragraph_index} not found in document",
        )

    # Delete the paragraph
    await db.delete(target)
    await db.flush()

    # Re-index subsequent paragraphs with a single raw SQL UPDATE.
    # This avoids SQLAlchemy executemany batching order issues that
    # can cause temporary UNIQUE (document_id, index) conflicts.
    from sqlalchemy import update as sa_update

    await db.execute(
        sa_update(Paragraph)
        .where(
            Paragraph.document_id == document.id,
            Paragraph.index > paragraph_index,
        )
        .values(index=Paragraph.index - 1)
    )
    await db.flush()

    # Expire the collection so the next access re-loads fresh indices
    await db.refresh(document, attribute_names=["paragraphs"])

    # Recalculate document aggregates
    all_paragraphs = sorted(document.paragraphs, key=lambda p: p.index)
    document.original_text = "\n\n".join(p.text_en for p in all_paragraphs)
    document.word_count = sum(len(p.text_en.split()) for p in all_paragraphs)
    document.paragraph_count = len(all_paragraphs)

    await db.commit()

    return DeleteParagraphResponse(
        document_id=task_id,
        deleted_index=paragraph_index,
        message=f"已删除段落 {paragraph_index + 1}",
    )


@router.post(
    "/documents/{task_id}/paragraphs/merge",
    response_model=MergeParagraphsResponse,
)
async def merge_paragraphs(
    task_id: str,
    body: MergeParagraphsRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Merge two adjacent paragraphs into one.

    Appends the text of paragraph index_b to paragraph index_a,
    then deletes paragraph index_b and re-indexes subsequent paragraphs.
    """
    document = await _get_owned_document(task_id, current_user, db)

    if document.parse_status != "completed":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot edit paragraphs for a document with status '{document.parse_status}'",
        )

    # Validate indices
    if abs(body.index_b - body.index_a) != 1:
        raise HTTPException(
            status_code=400,
            detail=f"Paragraphs must be adjacent. Got index {body.index_a} and {body.index_b}.",
        )

    para_a = next(
        (p for p in document.paragraphs if p.index == body.index_a), None
    )
    para_b = next(
        (p for p in document.paragraphs if p.index == body.index_b), None
    )

    if para_a is None:
        raise HTTPException(
            status_code=404,
            detail=f"Paragraph index {body.index_a} not found",
        )
    if para_b is None:
        raise HTTPException(
            status_code=404,
            detail=f"Paragraph index {body.index_b} not found",
        )

    # Merge: keep para_a, append para_b text, delete para_b
    para_a.text_en = para_a.text_en.rstrip() + " " + para_b.text_en.lstrip()
    para_a.text_zh = None  # Invalidate stale translation

    await db.delete(para_b)
    await db.flush()

    # Re-index subsequent paragraphs with a single raw SQL UPDATE.
    # This avoids SQLAlchemy executemany batching order issues that
    # can cause temporary UNIQUE (document_id, index) conflicts.
    from sqlalchemy import update as sa_update

    await db.execute(
        sa_update(Paragraph)
        .where(
            Paragraph.document_id == document.id,
            Paragraph.index > body.index_b,
        )
        .values(index=Paragraph.index - 1)
    )
    await db.flush()

    # Expire the collection so the next access re-loads fresh indices
    await db.refresh(document, attribute_names=["paragraphs"])

    # Recalculate document aggregates
    all_paragraphs = sorted(document.paragraphs, key=lambda p: p.index)
    document.original_text = "\n\n".join(p.text_en for p in all_paragraphs)
    document.word_count = sum(len(p.text_en.split()) for p in all_paragraphs)
    document.paragraph_count = len(all_paragraphs)

    await db.commit()

    return MergeParagraphsResponse(
        document_id=task_id,
        merged_index=min(body.index_a, body.index_b),
        message=f"已将段落 {body.index_b + 1} 合并到段落 {body.index_a + 1}",
    )


@router.put(
    "/documents/{task_id}/paragraphs/reorder",
    response_model=ReorderParagraphsResponse,
)
async def reorder_paragraphs(
    task_id: str,
    body: ReorderParagraphsRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Reorder paragraphs by specifying the new index order.

    Accepts a list of indices in the desired new order. All paragraphs
    will be reassigned with contiguous indices starting from 0.
    Cross-page moves update page_number based on neighbors.
    Unlike updateParagraphs, this does NOT invalidate translations.
    """
    document = await _get_owned_document(task_id, current_user, db)

    if document.parse_status != "completed":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot reorder paragraphs for a document with status '{document.parse_status}'",
        )

    # Validate: must include all existing indices exactly once
    existing_indices = {p.index for p in document.paragraphs}
    requested_indices = set(body.ordered_indices)

    if requested_indices != existing_indices:
        raise HTTPException(
            status_code=400,
            detail="ordered_indices must contain all existing paragraph indices exactly once",
        )

    para_map = {p.index: p for p in document.paragraphs}

    # Phase 1: assign temporary negative indices to avoid UNIQUE constraint
    # conflicts during reorder (no two paragraphs share the same index at
    # any moment).
    for i, old_idx in enumerate(body.ordered_indices):
        para = para_map[old_idx]
        para.index = -(i + 1)  # temporary unique value: -1, -2, -3, ...

    await db.flush()

    # Phase 2: assign final contiguous indices and propagate page_number
    for new_idx, old_idx in enumerate(body.ordered_indices):
        para = para_map[old_idx]
        para.index = new_idx

        # Adopt page_number from the previous paragraph in the new order
        if new_idx > 0:
            prev_para = para_map[body.ordered_indices[new_idx - 1]]
            if prev_para.page_number is not None:
                para.page_number = prev_para.page_number

    await db.flush()

    # Recalculate document aggregates
    all_paragraphs = sorted(document.paragraphs, key=lambda p: p.index)
    document.original_text = "\n\n".join(p.text_en for p in all_paragraphs)
    document.word_count = sum(len(p.text_en.split()) for p in all_paragraphs)
    document.paragraph_count = len(all_paragraphs)

    await db.commit()

    return ReorderParagraphsResponse(
        document_id=task_id,
        message=f"已重新排序 {len(body.ordered_indices)} 个段落",
    )


@router.post("/select-pages", response_model=SelectPagesResponse)
async def select_pages(
    background_tasks: BackgroundTasks,
    body: SelectPagesRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Select which pages to include and start parsing.

    Validates page selection (range and max 10), stores it on the
    Document record, then triggers background parsing.
    """
    document = await _get_owned_document(body.task_id, current_user, db)

    if document.parse_status != "awaiting_selection":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot select pages when status is '{document.parse_status}'",
        )

    # Validate page range (only if specific pages selected)
    if body.selected_pages is not None and len(body.selected_pages) > 0:
        if document.page_count is None:
            raise HTTPException(status_code=400, detail="Page count unknown for this document")

        max_page = document.page_count
        for p in body.selected_pages:
            if p < 1 or p > max_page:
                raise HTTPException(
                    status_code=400,
                    detail=f"Page {p} is out of range (1–{max_page})",
                )

        if len(body.selected_pages) > 10:
            raise HTTPException(status_code=400, detail="Maximum 10 pages allowed")

        selected_count = len(body.selected_pages)
        msg = f"开始解析 {selected_count} 个页面，可能需要几分钟"
    else:
        # Parse all pages (no filtering)
        body.selected_pages = None
        msg = "开始解析全部页面，可能需要几分钟"

    # Store selected pages and start parsing
    document.selected_pages = body.selected_pages
    document.parse_status = "processing"
    await db.commit()

    # Start background parsing with user's MinerU token
    background_tasks.add_task(
        _parse_in_background, document.id, document.file_path, body.mineru_token or ""
    )

    return SelectPagesResponse(
        task_id=body.task_id,
        status="processing",
        selected_pages=body.selected_pages or [],
        message=msg,
    )


@router.get("/documents", response_model=DocumentListResponse)
async def list_documents(
    limit: int = 20,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List the current user's uploaded documents, newest first.

    Args:
        limit: Max results per page (default 20).
        offset: Pagination offset.
    """
    docs, total = await pdf_service.list_documents(
        db, limit=limit, offset=offset, user_id=current_user.id
    )

    items = [
        DocumentListItem(
            id=str(d.id),
            title=d.title,
            source=d.source,
            word_count=d.word_count,
            parse_status=d.parse_status,
            source_type=d.source_type,
            file_ext=d.file_ext,
            created_at=d.created_at,
        )
        for d in docs
    ]

    return DocumentListResponse(documents=items, total=total)


@router.post("/documents/batch-delete", response_model=BatchDeleteResponse)
async def batch_delete_documents(
    body: BatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete multiple documents at once (user-scoped).

    Only deletes documents owned by the current user. Invalid IDs,
    IDs belonging to other users, and already-deleted documents
    are silently skipped and reported in failed_ids.

    Args:
        body: {document_ids: [...]} — max 100 IDs per request.
    """
    import os as _os

    deleted_count = 0
    failed_ids: list[str] = []

    for doc_id_str in body.document_ids:
        try:
            doc_uuid = uuid.UUID(doc_id_str)
        except ValueError:
            failed_ids.append(doc_id_str)
            continue

        document = await pdf_service.get_document(doc_uuid, db, user_id=current_user.id)
        if document is None:
            failed_ids.append(doc_id_str)
            continue

        # Remove PDF file from disk
        if document.file_path and _os.path.exists(document.file_path):
            try:
                _os.remove(document.file_path)
            except OSError:
                pass

        await db.delete(document)
        deleted_count += 1

    await db.commit()

    return BatchDeleteResponse(
        deleted_count=deleted_count,
        failed_ids=failed_ids,
        message=f"成功删除 {deleted_count} 个文档"
        + (f"，{len(failed_ids)} 个失败" if failed_ids else ""),
    )


@router.delete("/documents/{task_id}")
async def delete_document(
    task_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a document and its PDF file from disk.

    Works for documents in any status (completed, failed, stuck, etc.).
    """
    import os as _os

    document = await _get_owned_document(task_id, current_user, db)

    # Remove PDF file from disk
    if document.file_path and _os.path.exists(document.file_path):
        try:
            _os.remove(document.file_path)
        except OSError:
            pass  # Best-effort cleanup

    # Delete from database (cascades to paragraphs, word_analyses, etc.)
    await db.delete(document)
    await db.commit()

    return {"detail": "Document deleted successfully"}


@router.post("/retry/{task_id}", response_model=PDFUploadResponse)
async def retry_document(
    background_tasks: BackgroundTasks,
    task_id: str,
    body: RetryDocumentRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retry a failed or stuck document.

    - 'failed' documents: reset status and restart parsing.
    - 'awaiting_selection' documents: just return page_count so the
      frontend can re-enter the page selection flow.
    """
    document = await _get_owned_document(task_id, current_user, db)

    if document.parse_status == "awaiting_selection":
        # Already in selection state — just return info for frontend to resume
        return PDFUploadResponse(
            task_id=task_id,
            status="awaiting_selection",
            page_count=document.page_count,
            source_type=document.source_type,
            file_ext=document.file_ext,
        )

    if document.parse_status in ("failed", "processing"):
        # Reset to selection state if page count known, otherwise parse immediately
        if document.page_count is not None and document.page_count >= 1:
            document.parse_status = "awaiting_selection"
            await db.commit()
            return PDFUploadResponse(
                task_id=task_id,
                status="awaiting_selection",
                page_count=document.page_count,
                source_type=document.source_type,
                file_ext=document.file_ext,
            )
        else:
            document.parse_status = "processing"
            document.error_message = None
            await db.commit()
            background_tasks.add_task(
                _parse_in_background, document.id, document.file_path, body.mineru_token
            )
            return PDFUploadResponse(
                task_id=task_id,
                status="processing",
                page_count=document.page_count,
                source_type=document.source_type,
                file_ext=document.file_ext,
            )

    if document.parse_status == "completed":
        raise HTTPException(
            status_code=400, detail="Document is already completed"
        )

    raise HTTPException(
        status_code=400,
        detail=f"Cannot retry document with status '{document.parse_status}'",
    )


@router.post("/export")
async def export_pdf(
    body: PDFExportRequest,
    current_user: User = Depends(get_current_user),
):
    """导出 PDF：接收序列化 HTML → Chrome 无头渲染 → 返回文件流。

    纸张尺寸由 HTML 内 @page 规则控制；文件名由前端 <a download> 指定。
    """
    max_bytes = settings.PDF_EXPORT_HTML_MAX_MB * 1024 * 1024
    if len(body.html.encode("utf-8")) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"导出内容过大（>{settings.PDF_EXPORT_HTML_MAX_MB}MB），请减少内容后重试",
        )
    try:
        async with pdf_render_semaphore:
            pdf_bytes = await asyncio.to_thread(render_html_to_pdf, body.html)
    except ChromeUnavailableError as exc:
        raise HTTPException(
            status_code=503,
            detail="服务器未安装 Chrome/Edge，无法生成 PDF。请联系管理员安装或配置 CHROME_PATH",
        ) from exc
    except ChromeTimeoutError as exc:
        raise HTTPException(status_code=504, detail="PDF 生成超时，请重试或减少导出内容") from exc
    except ChromeRenderError as exc:
        _logger.exception("Chrome PDF render failed")
        raise HTTPException(status_code=502, detail="PDF 生成失败，请稍后重试") from exc
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="export.pdf"'},
    )
