"""Chrome 无头模式渲染 HTML → PDF（导出下载）。

零新依赖：直接 subprocess 调用系统 Chrome/Edge（--headless=new --print-to-pdf）。
纸张尺寸完全由 HTML 内 @page 控制（CLI 无纸张参数）。
"""

import asyncio
import logging
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from app.config import settings

logger = logging.getLogger(__name__)


class ChromeUnavailableError(Exception):
    """未找到 Chrome/Edge 可执行文件"""


class ChromeRenderError(Exception):
    """Chrome 渲染失败"""


class ChromeTimeoutError(Exception):
    """渲染超时"""


CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

# 并发限制（同时运行的 Chrome 进程数）
pdf_render_semaphore = asyncio.Semaphore(settings.PDF_EXPORT_CONCURRENCY)

_chrome_path: str | None = None

_WINDOWS_CHROME_CANDIDATES = (
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe",
)


def _find_chrome() -> str:
    """查找 Chrome/Edge 可执行文件：CHROME_PATH → PATH → Windows 常见路径。"""
    if settings.CHROME_PATH:
        if os.path.isfile(settings.CHROME_PATH):
            return settings.CHROME_PATH
        raise ChromeUnavailableError(
            f"CHROME_PATH 配置无效（文件不存在）：{settings.CHROME_PATH}"
        )
    for name in (
        "chrome",
        "chromium",
        "google-chrome",
        "google-chrome-stable",
        "chromium-browser",
        "msedge",
    ):
        p = shutil.which(name)
        if p:
            return p
    if sys.platform == "win32":
        for candidate in _WINDOWS_CHROME_CANDIDATES:
            p = os.path.expandvars(candidate)
            if os.path.exists(p):
                return p
    raise ChromeUnavailableError(
        "未找到 Chrome/Edge 可执行文件。请在服务器安装 Chrome/Edge，或设置 CHROME_PATH 环境变量。"
    )


def get_chrome_path() -> str:
    """查找 Chrome（成功结果缓存；失败不缓存，可重试）。"""
    global _chrome_path
    if _chrome_path:
        return _chrome_path
    _chrome_path = _find_chrome()
    return _chrome_path


def render_html_to_pdf(html: str) -> bytes:
    """渲染 HTML → PDF 字节（临时文件 try/finally 清理）。"""
    chrome = get_chrome_path()
    html_fd, html_path = tempfile.mkstemp(suffix=".html", prefix="pdf-export-")
    pdf_path: str | None = None
    profile_dir: str | None = None
    try:
        with os.fdopen(html_fd, "w", encoding="utf-8") as f:
            f.write(html)
        pdf_fd, pdf_path = tempfile.mkstemp(suffix=".pdf", prefix="pdf-export-")
        os.close(pdf_fd)  # 立即关闭，否则 Windows 下文件被锁定无法 unlink
        profile_dir = tempfile.mkdtemp(prefix="chrome-profile-")
        cmd = [
            chrome,
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-javascript",
            f"--user-data-dir={profile_dir}",
            f"--print-to-pdf={pdf_path}",
            "--no-pdf-header-footer",
            "--run-all-compositor-stages-before-draw",
            f"--virtual-time-budget={settings.PDF_EXPORT_VIRTUAL_TIME_MS}",
            Path(html_path).as_uri(),
        ]
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=settings.PDF_EXPORT_TIMEOUT_SECONDS,
                creationflags=CREATE_NO_WINDOW,
            )
        except subprocess.TimeoutExpired as exc:
            raise ChromeTimeoutError(
                f"PDF 渲染超时（>{settings.PDF_EXPORT_TIMEOUT_SECONDS}s）"
            ) from exc
        if (
            proc.returncode != 0
            or not pdf_path
            or not os.path.exists(pdf_path)
            or os.path.getsize(pdf_path) == 0
        ):
            raise ChromeRenderError(
                f"Chrome 渲染失败（exit={proc.returncode}）：{proc.stderr[-2000:]}"
            )
        with open(pdf_path, "rb") as f:
            return f.read()
    finally:
        for p in (html_path, pdf_path):
            if p and os.path.exists(p):
                try:
                    os.unlink(p)
                except OSError:
                    pass
        if profile_dir and os.path.isdir(profile_dir):
            shutil.rmtree(profile_dir, ignore_errors=True)
