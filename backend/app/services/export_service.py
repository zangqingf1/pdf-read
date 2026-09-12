"""Chrome 无头模式渲染 HTML → PDF（导出下载）。

零新依赖：直接 subprocess 调用系统 Chrome/Edge（--headless=new --print-to-pdf）。
纸张尺寸完全由 HTML 内 @page 控制（CLI 无纸张参数）。

安全模型：待渲染的 HTML 来自用户，必须视为不可信。历史实现把它写到临时文件
再用 file:// 打开，于是页面 origin 就是 file://，用户 HTML 里的
`<iframe src="file:///…">` 能把服务器任意本地文件（.env / 数据库）渲染进返回的
PDF —— 实测可读出密钥。现在改为：

1. HTML 只经内存传给一个绑定 127.0.0.1 的一次性 HTTP 服务，文档源是 http:，
   Chrome 会拒绝从 http 源加载 file:// 子资源（"Not allowed to load local resource"）；
2. CSP 走该 HTTP 响应头下发（响应头对整篇文档生效，不像 <meta> 那样受注入位置影响），
   脚本 / 子框架 / 外链 / connect 全部回落到 default-src 'none' 被禁；
3. --host-resolver-rules 只放行本次回环服务，其余主机名一律解析失败。

注意：不要加回 `--disable-javascript`。它在 `--headless=new` 下已失效（实测脚本
仍会执行），留着只会给人虚假的安全感；脚本拦截由上面第 2 条的 CSP 负责。
`--no-sandbox` 保留（部分容器化部署依赖它），残余风险见 AGENTS.md。
"""

import asyncio
import http.server
import logging
import os
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading

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

# 导出文档的安全策略：前端序列化产物只包含内联样式与 data: 内联字体，无图片、
# 无脚本、无外链，因此除这两项外全部禁止（script/frame/object/connect 回落到
# default-src 'none'）。
_EXPORT_CSP = "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:"

# 只放行本次渲染用到的回环服务；其余主机名（含内网 IP / 云 metadata）一律解析失败。
# 缺少 EXCLUDE 127.0.0.1 时连回环地址本身都会被禁掉，渲染会产出 0 字节 PDF。
_HOST_RESOLVER_RULES = "MAP * ~NOTFOUND,EXCLUDE 127.0.0.1"

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


class _ExportHtmlServer:
    """一次性回环 HTTP 服务：把待渲染 HTML 交给 Chrome，渲染结束立即关闭。

    - 只绑定 127.0.0.1 的临时端口，路径带随机 token，其余请求一律 404。
    - CSP 由响应头下发，覆盖整篇文档。
    - 每个实例独立持有自己的 html/token，因此 PDF_EXPORT_CONCURRENCY > 1 并发渲染
      时不会互相串数据。
    - 绑定失败时向上抛错（intentionally fail closed）：宁可导出不可用，也不能退回
      到 file:// 把本地文件读取漏洞放回来。
    """

    def __init__(self, html: bytes) -> None:
        self._html = html
        self._token = secrets.token_urlsafe(24)
        outer = self

        class _Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802  (stdlib 规定的驼峰名)
                if self.path != f"/{outer._token}":
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Security-Policy", _EXPORT_CSP)
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Content-Length", str(len(outer._html)))
                self.end_headers()
                self.wfile.write(outer._html)

            def log_message(self, *args) -> None:
                pass  # 默认实现会往 stderr 打日志，导出期间噪音太大

        try:
            self._httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        except OSError as exc:
            raise ChromeRenderError(
                f"无法启动导出渲染用的本地回环服务（{exc}）。导出已中止，未降级为 file://。"
            ) from exc
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self._httpd.server_address[1]}/{self._token}"

    def __enter__(self) -> "_ExportHtmlServer":
        self._thread.start()
        return self

    def __exit__(self, *exc_info) -> None:
        self._httpd.shutdown()
        self._httpd.server_close()
        self._thread.join(timeout=5)


def render_html_to_pdf(html: str) -> bytes:
    """渲染 HTML → PDF 字节（临时文件 try/finally 清理）。"""
    chrome = get_chrome_path()
    pdf_path: str | None = None
    profile_dir: str | None = None
    try:
        pdf_fd, pdf_path = tempfile.mkstemp(suffix=".pdf", prefix="pdf-export-")
        os.close(pdf_fd)  # 立即关闭，否则 Windows 下文件被锁定无法 unlink
        profile_dir = tempfile.mkdtemp(prefix="chrome-profile-")

        with _ExportHtmlServer(html.encode("utf-8")) as server:
            cmd = [
                chrome,
                "--headless=new",
                "--disable-gpu",
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--no-first-run",
                "--no-default-browser-check",
                f"--host-resolver-rules={_HOST_RESOLVER_RULES}",
                "--disable-background-networking",
                f"--user-data-dir={profile_dir}",
                f"--print-to-pdf={pdf_path}",
                "--no-pdf-header-footer",
                "--run-all-compositor-stages-before-draw",
                f"--virtual-time-budget={settings.PDF_EXPORT_VIRTUAL_TIME_MS}",
                server.url,
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
            or not os.path.exists(pdf_path)
            or os.path.getsize(pdf_path) == 0
        ):
            raise ChromeRenderError(
                f"Chrome 渲染失败（exit={proc.returncode}）：{proc.stderr[-2000:]}"
            )
        with open(pdf_path, "rb") as f:
            return f.read()
    finally:
        if pdf_path and os.path.exists(pdf_path):
            try:
                os.unlink(pdf_path)
            except OSError:
                pass
        if profile_dir and os.path.isdir(profile_dir):
            shutil.rmtree(profile_dir, ignore_errors=True)
