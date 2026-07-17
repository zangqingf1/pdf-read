"""Celery async tasks for PDF parsing (F01).

Falls back to synchronous operation if Celery is not available.
"""

import uuid
import asyncio

from app.tasks.celery_app import celery_app


async def _parse_pdf_async(task_id: str, file_path: str, mineru_token: str = ""):
    """Async implementation of PDF parsing."""
    from app.database import async_session_factory
    from app.models.document import Document
    from app.services.pdf_service import pdf_service
    from sqlalchemy import select

    async with async_session_factory() as db:
        try:
            doc_id = uuid.UUID(task_id)
            await pdf_service.parse_document(doc_id, db, mineru_token=mineru_token)
            await db.commit()
        except Exception as e:
            stmt = select(Document).where(Document.id == uuid.UUID(task_id))
            result = await db.execute(stmt)
            doc = result.scalar_one_or_none()
            if doc:
                doc.parse_status = "failed"
                doc.error_message = str(e)[:500]
                await db.commit()
            raise e


def parse_pdf_sync(task_id: str, file_path: str, mineru_token: str = ""):
    """Synchronous wrapper for environments without Celery."""
    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(_parse_pdf_async(task_id, file_path, mineru_token))
    finally:
        loop.close()
    return {"status": "completed", "document_id": task_id}


if celery_app is not None:
    @celery_app.task(bind=True, name="parse_pdf")
    def parse_pdf_task(self, task_id: str, file_path: str, mineru_token: str = ""):
        """Celery task: Parse a PDF file."""
        return parse_pdf_sync(task_id, file_path, mineru_token)
else:
    # No Celery — expose sync function directly
    parse_pdf_task = None
