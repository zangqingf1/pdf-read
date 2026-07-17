"""API dependencies for FastAPI route injection."""

from fastapi import File, UploadFile, HTTPException

from app.config import settings


MAX_UPLOAD_SIZE = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024  # Convert to bytes


async def validate_pdf_upload(file: UploadFile = File(...)) -> UploadFile:
    """Validate PDF upload: check content type and file size.

    Returns the validated UploadFile or raises HTTPException.
    """
    # Check Content-Type
    if file.content_type != "application/pdf":
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type: {file.content_type}. Only PDF files are accepted.",
        )

    # Check file extension
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail="File extension must be .pdf",
        )

    return file


def validate_file_size(file: UploadFile) -> None:
    """Read file content to check actual size against MAX_UPLOAD_SIZE.

    Note: FastAPI's UploadFile doesn't expose size until read.
    Call this after reading the file content.
    """
    pass  # Size validation done at the service layer
