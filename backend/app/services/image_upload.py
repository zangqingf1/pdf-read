"""常见图片上传校验（头像 / 反馈截图共用）。

为什么单独成模块：头像与反馈截图都接受用户上传的图片，魔术字节白名单与
PIL 重编码（丢弃合法图片尾部拼接的 polyglot 载荷）属于安全逻辑 —— 复制成
两份后必然漂移，所以只留一份实现，各调用方通过 ``label`` 定制文案。

Security:
- Whitelist of image extensions.
- Content sniffing via magic bytes (a renamed text file is rejected).
- Decode + re-encode via PIL to strip trailing polyglot payloads.
- Size cap supplied by the caller (per-feature setting).
- Callers are responsible for random filenames (no user-controlled paths).
"""

import logging
from io import BytesIO

from fastapi import HTTPException, UploadFile, status

logger = logging.getLogger(__name__)

try:
    from PIL import Image

    _HAS_PIL = True
except ImportError:  # pragma: no cover - optional dependency
    _HAS_PIL = False

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
IMAGE_MEDIA_TYPES = {
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


def sniff_image_type(data: bytes) -> str | None:
    """Return the extension matching the content's magic bytes, or None."""
    for sig, ext in _SIGNATURES.items():
        if data.startswith(sig):
            return ext
    # WebP: RIFF....WEBP
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return ".webp"
    return None


def sanitize_image(raw: bytes) -> tuple[bytes, str] | None:
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


async def load_image(
    file: UploadFile, *, max_mb: int, label: str
) -> tuple[bytes, str]:
    """Validate an uploaded image and return ``(safe_bytes, extension)``.

    ``label`` is the Chinese noun used in error messages, e.g. ``"头像"``
    或 ``"截图"``. Raises HTTPException (400/413) on invalid content or size.
    """
    raw = await file.read()
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{label}文件为空。",
        )

    max_bytes = max_mb * 1024 * 1024
    if len(raw) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"{label}不能超过 {max_mb}MB。",
        )

    ext = sniff_image_type(raw)
    if ext is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{label}必须是 PNG、JPG、GIF 或 WebP 图片。",
        )

    if _HAS_PIL:
        sanitized = sanitize_image(raw)
        if sanitized is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{label}文件不是有效的图片。",
            )
        return sanitized

    return raw, ext
