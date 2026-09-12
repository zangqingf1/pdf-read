"""Avatar upload/storage helpers.

Validation (magic-byte whitelist + PIL re-encode) is shared with feedback
screenshots — see ``app.services.image_upload``. This module only owns the
avatar-specific storage layout and cleanup.

Security:
- Random filename — no user-controlled path components, no traversal.
- Old file removed only AFTER the new file is safely written.
"""

import logging
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile, status

from app.config import settings
from app.services.image_upload import (
    IMAGE_EXTENSIONS,
    IMAGE_MEDIA_TYPES,
    load_image,
    sniff_image_type,  # re-exported for callers/tests
)

logger = logging.getLogger(__name__)

ALLOWED_AVATAR_EXTENSIONS = IMAGE_EXTENSIONS
AVATAR_MEDIA_TYPES = IMAGE_MEDIA_TYPES

__all__ = [
    "ALLOWED_AVATAR_EXTENSIONS",
    "AVATAR_MEDIA_TYPES",
    "sniff_image_type",
    "save_avatar",
    "delete_avatar_file",
    "resolve_avatar_path",
]


def _avatar_dir() -> Path:
    return Path(settings.UPLOAD_DIR) / "avatars"


async def save_avatar(file: UploadFile, user_id: str) -> str:
    """Validate and persist an avatar upload.

    Returns the stored relative path (e.g. ``avatars/<user_id>-<hex>.png``),
    which is saved as ``users.avatar_url``.

    Raises HTTPException (400/413) on invalid content or size.
    """
    final_bytes, final_ext = await load_image(
        file, max_mb=settings.AVATAR_MAX_MB, label="头像"
    )

    folder = _avatar_dir()
    folder.mkdir(parents=True, exist_ok=True)
    filename = f"{user_id}-{uuid.uuid4().hex}{final_ext}"
    target = folder / filename

    try:
        target.write_bytes(final_bytes)
    except OSError as exc:
        logger.error("Failed to write avatar %s: %s", target, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="头像保存失败，请稍后重试。",
        )

    return f"avatars/{filename}"


def delete_avatar_file(avatar_url: str | None) -> None:
    """Best-effort removal of a stored avatar file (never raises)."""
    if not avatar_url:
        return
    # Only accept our own relative layout (defense in depth).
    rel = avatar_url.replace("\\", "/")
    if not rel.startswith("avatars/") or "/" in rel[len("avatars/") :]:
        logger.warning("Refusing to delete non-avatar path: %s", avatar_url)
        return
    path = Path(settings.UPLOAD_DIR) / rel
    try:
        if path.is_file():
            path.unlink()
    except OSError as exc:
        logger.warning("Failed to remove avatar file %s: %s", path, exc)


def resolve_avatar_path(avatar_url: str | None) -> Path | None:
    """Resolve a stored relative avatar URL to an absolute file path (or None)."""
    if not avatar_url:
        return None
    rel = avatar_url.replace("\\", "/")
    if not rel.startswith("avatars/") or "/" in rel[len("avatars/") :]:
        return None
    path = Path(settings.UPLOAD_DIR) / rel
    return path if path.is_file() else None
