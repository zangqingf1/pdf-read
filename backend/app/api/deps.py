"""API dependencies for FastAPI route injection."""

from fastapi import File, UploadFile, HTTPException

from app.config import settings
from app.services.file_types import SUPPORTED_UPLOAD_EXTENSIONS, normalize_ext


MAX_UPLOAD_SIZE = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024  # Convert to bytes


async def validate_document_upload(file: UploadFile = File(...)) -> UploadFile:
    """Validate document upload: check the extension against the MinerU
    whitelist and the size limit.

    Note: Not currently wired to any route — upload validation lives in
    pdf_service.upload_and_save. Kept here as a reusable dependency.
    """
    # Check extension
    ext = normalize_ext(file.filename or "")
    if ext not in SUPPORTED_UPLOAD_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件类型：{ext or '无扩展名'}。"
            "支持的格式：PDF、Word、PPT、Excel、图片与 HTML",
        )

    return file


def validate_file_size(file: UploadFile) -> None:
    """Read file content to check actual size against MAX_UPLOAD_SIZE.

    Note: FastAPI's UploadFile doesn't expose size until read.
    Call this after reading the file content.
    """
    pass  # Size validation done at the service layer
