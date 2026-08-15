"""Avatar upload/storage helpers.

Security:
- Whitelist of image extensions.
- Content sniffing via magic bytes (a renamed text file is rejected).
- Size cap (settings.AVATAR_MAX_MB).
- Random filename — no user-controlled path components, no traversal.
- Old file removed only AFTER the new file is safely written.
"""

import logging
import uuid
from io import BytesIO
from pathlib import Path

from fastapi import HTTPException, UploadFile, status

from app.config import settings

logger = logging.getLogger(__name__)

try:
    from PIL import Image

    _HAS_PIL = True
except ImportError:  # pragma: no cover - optional dependency
    _HAS_PIL = False

ALLOWED_AVATAR_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
AVATAR_MEDIA_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
}

# Magic-byte signatures → extension
_SIGNATURES: dict[bytes, str] = {
    b"\x89PNG\r\n\x1a\n": ".png",
    b"\xff\xd8\xff": ".jpg",
    b"GIF87a": ".gif",
    b"GIF89a": ".gif",
}


def _avatar_dir() -> Path:
    return Path(settings.UPLOAD_DIR) / "avatars"


def sniff_image_type(data: bytes) -> str | None:
    """Return the extension matching the content's magic bytes, or None."""
    for sig, ext in _SIGNATURES.items():
        if data.startswith(sig):
            return ext
    # WebP: RIFF....WEBP
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return ".webp"
    return None


def _sanitize_image(raw: bytes) -> tuple[bytes, str] | None:
    """Decode and re-encode an image, dropping trailing polyglot payloads.

    Returns ``(safe_bytes, final_ext)`` or None when the bytes are not a
    decodable image. GIF/WebP are normalized to PNG; JPEG stays JPEG.
    """
    try:
        with Image.open(BytesIO(raw)) as img:
            img.verify()
        with Image.open(BytesIO(raw)) as img:
            out = BytesIO()
            if img.format in ("JPEG", "JPG"):
                img.convert("RGB").save(out, "JPEG", quality=90)
                return out.getvalue(), ".jpg"
            if img.format == "PNG":
                img.save(out, "PNG")
                return out.getvalue(), ".png"
            img.convert("RGBA").save(out, "PNG")
            return out.getvalue(), ".png"
    except Exception:
        return None


async def save_avatar(file: UploadFile, user_id: str) -> str:
    """Validate and persist an avatar upload.

    Returns the stored relative path (e.g. ``avatars/<user_id>-<hex>.png``),
    which is saved as ``users.avatar_url``.

    Raises HTTPException (400/413) on invalid content or size.
    """
    raw = await file.read()
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="头像文件为空。",
        )

    max_bytes = settings.AVATAR_MAX_MB * 1024 * 1024
    if len(raw) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"头像文件不能超过 {settings.AVATAR_MAX_MB}MB。",
        )

    ext = sniff_image_type(raw)
    if ext is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="头像必须是 PNG、JPG、GIF 或 WebP 图片。",
        )

    final_bytes: bytes = raw
    final_ext: str = ext
    if _HAS_PIL:
        sanitized = _sanitize_image(raw)
        if sanitized is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="头像文件不是有效的图片。",
            )
        final_bytes, final_ext = sanitized

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
