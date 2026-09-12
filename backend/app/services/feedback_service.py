"""Feedback screenshot storage helpers.

Validation (magic-byte whitelist + PIL re-encode) is shared with avatars —
see ``app.services.image_upload``. This module owns the ``uploads/feedback/``
layout plus the strict path checks used when serving/deleting a screenshot.
"""

import json
import logging
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile, status

from app.config import settings
from app.services.image_upload import IMAGE_MEDIA_TYPES, load_image

logger = logging.getLogger(__name__)

_SUBDIR = "feedback"


def decode_image_paths(raw: str | None) -> list[str]:
    """Parse the stored screenshot-path JSON array (tolerant of bad/legacy data)."""
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return []
    if not isinstance(data, list):
        return []
    return [p for p in data if isinstance(p, str)]


def encode_image_paths(paths: list[str]) -> str | None:
    return json.dumps(paths, ensure_ascii=False) if paths else None


def _feedback_dir() -> Path:
    return Path(settings.UPLOAD_DIR) / _SUBDIR


async def save_feedback_images(files: list[UploadFile], user_id: str) -> list[str]:
    """Validate and persist feedback screenshots (up to ``FEEDBACK_MAX_IMAGES``).

    Every file is validated (and re-encoded) before anything is written, so a
    rejected batch never leaves partial files on disk. Returns the stored
    relative paths in the caller's order.

    Raises HTTPException (400/413/500) on too many images, invalid content,
    oversize per-file or total size, or a write failure.
    """
    max_images = settings.FEEDBACK_MAX_IMAGES
    if len(files) > max_images:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"最多上传 {max_images} 张截图。",
        )

    # 先全部校验再落盘：中途被拒时磁盘上不会留下半批文件
    validated: list[tuple[bytes, str]] = []
    total_bytes = 0
    total_limit = settings.FEEDBACK_MAX_TOTAL_MB * 1024 * 1024
    for file in files:
        data, ext = await load_image(
            file, max_mb=settings.FEEDBACK_MAX_MB, label="截图"
        )
        total_bytes += len(data)
        if total_bytes > total_limit:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"截图总大小不能超过 {settings.FEEDBACK_MAX_TOTAL_MB}MB。",
            )
        validated.append((data, ext))

    folder = _feedback_dir()
    folder.mkdir(parents=True, exist_ok=True)
    paths: list[str] = []
    for data, ext in validated:
        filename = f"{user_id}-{uuid.uuid4().hex}{ext}"
        target = folder / filename
        try:
            target.write_bytes(data)
        except OSError as exc:
            logger.error("Failed to write feedback image %s: %s", target, exc)
            delete_feedback_images(paths)  # 清掉本批已写入的文件
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="截图保存失败，请稍后重试。",
            )
        paths.append(f"{_SUBDIR}/{filename}")

    return paths


def delete_feedback_image(image_path: str | None) -> None:
    """Best-effort removal of a stored screenshot (never raises)."""
    path = _safe_path(image_path)
    if path is None:
        return
    try:
        if path.is_file():
            path.unlink()
    except OSError as exc:
        logger.warning("Failed to remove feedback image %s: %s", path, exc)


def delete_feedback_images(image_paths: list[str] | None) -> None:
    """Remove every stored screenshot of one feedback (never raises)."""
    for image_path in image_paths or []:
        delete_feedback_image(image_path)


def resolve_feedback_image_path(image_path: str | None) -> Path | None:
    """Resolve a stored relative path to an absolute file path (or None)."""
    path = _safe_path(image_path)
    return path if path is not None and path.is_file() else None


def media_type_for(image_path: str) -> str:
    return IMAGE_MEDIA_TYPES.get(Path(image_path).suffix.lower(), "application/octet-stream")


def _safe_path(image_path: str | None) -> Path | None:
    """Only accept our own ``feedback/<file>`` layout (defense in depth)."""
    if not image_path:
        return None
    rel = image_path.replace("\\", "/")
    if not rel.startswith(f"{_SUBDIR}/") or "/" in rel[len(_SUBDIR) + 1 :]:
        logger.warning("Refusing non-feedback image path: %s", image_path)
        return None
    return Path(settings.UPLOAD_DIR) / rel
