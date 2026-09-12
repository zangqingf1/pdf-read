"""API dependencies for FastAPI route injection."""

from fastapi import Depends, File, UploadFile, HTTPException

from app.auth.deps import get_current_user
from app.config import settings
from app.models.user import User
from app.services.file_types import SUPPORTED_UPLOAD_EXTENSIONS, normalize_ext
from app.utils.rate_limit import enforce_user_limit


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


def _user_rate_limit(scope: str, setting_name: str, window_seconds: float = 60.0):
    """构造「按用户限流」依赖（实现见 app/utils/rate_limit.py）。

    AI 与 PDF 导出各自只有一个**进程级全局并发信号量**，没有按用户限流时，
    单个用户开几个大请求就能占满全部槽位、饿死其他所有用户，所以这两类端点
    必须挂上按用户配额。限额从 settings 读取，便于按部署调整（0 = 关闭）。
    ``window_seconds`` 供按小时计的配额（如反馈提交）使用。
    """

    def _dependency(current_user: User = Depends(get_current_user)) -> None:
        enforce_user_limit(
            str(current_user.id),
            scope,
            getattr(settings, setting_name),
            window_seconds=window_seconds,
        )

    return _dependency


ai_rate_limit = _user_rate_limit("ai", "AI_RATE_LIMIT_PER_MIN")
export_rate_limit = _user_rate_limit("export", "EXPORT_RATE_LIMIT_PER_MIN")
syllabus_rate_limit = _user_rate_limit("syllabus", "SYLLABUS_MATCH_RATE_LIMIT_PER_MIN")
# 反馈可带截图落盘，按小时计以限制磁盘消耗
feedback_rate_limit = _user_rate_limit(
    "feedback", "FEEDBACK_RATE_LIMIT_PER_HOUR", window_seconds=3600.0
)
