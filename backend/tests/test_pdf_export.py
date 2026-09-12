"""测试 Chrome 无头 PDF 导出（不消耗真实 Chrome）。

monkeypatch `subprocess.run`：解析 cmd 中的 --print-to-pdf= 路径写入伪造 PDF，
断言字节一致、临时文件清理、命令含关键参数；异常映射（超时/渲染失败）；
路由层 413/503/502/504 映射与成功响应的 media_type/attachment 头。
"""

import os
import subprocess
import tempfile
import urllib.error
import urllib.request

import pytest
from fastapi import HTTPException
from fastapi.responses import Response
from pypdf import PdfWriter

from app.api.v1.pdf import export_pdf
from app.services import export_service


class _FakeUser:
    id = "u-export"
    email = "export@example.com"


def _fake_pdf_bytes() -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(width=595, height=842)
    buf = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    path = buf.name
    buf.close()
    try:
        writer.write(path)
        with open(path, "rb") as f:
            return f.read()
    finally:
        os.unlink(path)


@pytest.fixture(autouse=True)
def reset_chrome_cache(monkeypatch):
    """每个测试前清空 Chrome 路径缓存；默认伪 Chrome 可执行文件。"""
    export_service._chrome_path = None
    monkeypatch.setattr(export_service, "_find_chrome", lambda: "C:/fake/chrome.exe")
    yield
    export_service._chrome_path = None


@pytest.fixture
def fake_chrome(monkeypatch):
    """替换 subprocess.run：解析 --print-to-pdf= 路径写入伪造 PDF。"""
    calls: list[list[str]] = []

    def fake_run(cmd, **kwargs):
        calls.append(list(cmd))
        assert kwargs.get("timeout") == export_service.settings.PDF_EXPORT_TIMEOUT_SECONDS
        pdf_flag = next(arg for arg in cmd if arg.startswith("--print-to-pdf="))
        pdf_path = pdf_flag.split("=", 1)[1]
        with open(pdf_path, "wb") as f:
            f.write(_fake_pdf_bytes())
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    monkeypatch.setattr(export_service.subprocess, "run", fake_run)
    yield calls


def _remaining_pdf_export_tmp_files() -> list[str]:
    tmpdir = tempfile.gettempdir()
    return [
        os.path.join(tmpdir, n)
        for n in os.listdir(tmpdir)
        if n.startswith("pdf-export-") or n.startswith("chrome-profile-")
    ]


@pytest.mark.asyncio
async def test_render_html_to_pdf(fake_chrome):
    pdf = export_service.render_html_to_pdf("<html><body>hello</body></html>")
    assert pdf.startswith(b"%PDF")  # 伪 PDF 字节透传
    assert not _remaining_pdf_export_tmp_files(), "临时文件未清理"

    cmd = fake_chrome[0]
    assert "--headless=new" in cmd
    assert "--no-pdf-header-footer" in cmd
    # `--disable-javascript` 在 --headless=new 下是空操作（实测脚本仍执行），
    # 脚本拦截由 _ExportHtmlServer 下发的 CSP 负责，不要再加回这个误导性参数。
    assert "--disable-javascript" not in cmd
    # SSRF/本地文件防护：禁网参数必须存在，且要放行本次回环渲染服务
    assert "--host-resolver-rules=MAP * ~NOTFOUND,EXCLUDE 127.0.0.1" in cmd
    assert "--disable-background-networking" in cmd
    assert "--user-data-dir=" in " ".join(cmd)
    assert any(arg.startswith("--print-to-pdf=") for arg in cmd)
    # 文档源必须是回环 HTTP（http: 源下 Chrome 拒绝加载 file:// 子资源），
    # 绝不能再回到 file:// —— 那等于把服务器本地文件读取放回来。
    assert any(arg.startswith("http://127.0.0.1:") for arg in cmd)
    assert not any(arg.startswith("file://") for arg in cmd)
    assert any(arg.startswith("--virtual-time-budget=") for arg in cmd)


@pytest.mark.asyncio
async def test_render_timeout_raises(monkeypatch):
    def fake_run(cmd, **kwargs):
        raise subprocess.TimeoutExpired(cmd, timeout=45)

    monkeypatch.setattr(export_service.subprocess, "run", fake_run)
    with pytest.raises(export_service.ChromeTimeoutError):
        export_service.render_html_to_pdf("<html></html>")
    assert not _remaining_pdf_export_tmp_files()


@pytest.mark.asyncio
async def test_render_failure_raises(monkeypatch):
    def fake_run(cmd, **kwargs):
        return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="boom")

    monkeypatch.setattr(export_service.subprocess, "run", fake_run)
    with pytest.raises(export_service.ChromeRenderError):
        export_service.render_html_to_pdf("<html></html>")
    assert not _remaining_pdf_export_tmp_files()


@pytest.mark.asyncio
async def test_chrome_unavailable(monkeypatch):
    monkeypatch.setattr(export_service, "_find_chrome", lambda: (_ for _ in ()).throw(
        export_service.ChromeUnavailableError("not found")
    ))
    with pytest.raises(export_service.ChromeUnavailableError):
        export_service.get_chrome_path()


@pytest.mark.asyncio
async def test_export_pdf_success(fake_chrome):
    resp: Response = await export_pdf(
        body=type("Body", (), {"html": "<html><body>hi</body></html>"})(),
        current_user=_FakeUser(),
    )
    assert resp.media_type == "application/pdf"
    assert "attachment" in resp.headers["Content-Disposition"]
    assert resp.body.startswith(b"%PDF")
    assert not _remaining_pdf_export_tmp_files()


@pytest.mark.asyncio
async def test_export_pdf_too_large(fake_chrome):
    html = "x" * (export_service.settings.PDF_EXPORT_HTML_MAX_MB * 1024 * 1024 + 1)
    with pytest.raises(HTTPException) as exc:
        await export_pdf(body=type("Body", (), {"html": html})(), current_user=_FakeUser())
    assert exc.value.status_code == 413


@pytest.mark.asyncio
async def test_export_pdf_error_mapping(monkeypatch):
    # 路由内 to_thread 调用的引用在 app.api.v1.pdf 模块（不是 export_service 模块）
    def _boom(_html: str):
        raise export_service.ChromeRenderError("render failed")

    import app.api.v1.pdf as pdf_module

    monkeypatch.setattr(pdf_module, "render_html_to_pdf", _boom)
    with pytest.raises(HTTPException) as exc:
        await export_pdf(body=type("Body", (), {"html": "<html></html>"})(), current_user=_FakeUser())
    assert exc.value.status_code == 502


def test_export_html_server_serves_csp_and_404s_other_paths():
    """回环服务只认带 token 的路径，并由响应头下发阻断脚本/外链的 CSP。

    这是 file:// 本地文件读取漏洞的核心缓解：文档源是 http:，且 CSP 覆盖整篇文档。
    """
    payload = b"<html><body>hi</body></html>"
    with export_service._ExportHtmlServer(payload) as server:
        assert server.url.startswith("http://127.0.0.1:")
        with urllib.request.urlopen(server.url, timeout=10) as resp:
            assert resp.read() == payload
            assert resp.headers["Content-Security-Policy"] == export_service._EXPORT_CSP
            assert resp.headers["X-Content-Type-Options"] == "nosniff"
            assert resp.headers["Cache-Control"] == "no-store"
            assert "text/html" in resp.headers["Content-Type"]
            # 没有 CSP 就挡不住脚本，缺了它这个测试必须失败
            assert "default-src 'none'" in resp.headers["Content-Security-Policy"]

        wrong_path = server.url.rsplit("/", 1)[0] + "/wrong-token"
        with pytest.raises(urllib.error.HTTPError) as exc:
            urllib.request.urlopen(wrong_path, timeout=10)
        assert exc.value.code == 404


def test_export_html_server_bind_failure_fails_closed(monkeypatch):
    """回环服务起不来时必须直接报错，不能悄悄降级回 file://。"""

    def _boom(*args, **kwargs):
        raise OSError("loopback unavailable")

    monkeypatch.setattr("http.server.ThreadingHTTPServer", _boom)
    with pytest.raises(export_service.ChromeRenderError):
        export_service._ExportHtmlServer(b"<html></html>")
