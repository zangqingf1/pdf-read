"""测试：email_service 真实 SMTP 发送路径（mock smtplib，离线）。

防止回归：send_email 构建的邮件必须是合法的 multipart 消息并能通过
send_message 发送。曾因对 multipart 顶层调用 ``msg.set_charset()`` 而在
Python 3.13 上崩溃（TypeError/AttributeError）——该路径开发模式下走
console 兜底、此前从未被覆盖。
"""

from unittest import mock

import pytest

from app.config import settings
from app.services import email_service
from app.services.email_service import (
    EmailServiceUnavailable,
    build_verification_email,
    send_email,
)


def test_build_verification_email_contains_code():
    subject, text, html = build_verification_email("to@example.com", "123456", 10, "register")
    assert "123456" in text
    assert "123456" in html
    assert "注册" in subject
    subject2, _, _ = build_verification_email("to@example.com", "654321", 10, "reset_password")
    assert "重置" in subject2


def test_send_email_ssl_builds_valid_multipart_and_sends(monkeypatch):
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.qq.com")
    monkeypatch.setattr(settings, "SMTP_PORT", 465)
    monkeypatch.setattr(settings, "SMTP_USER", "sender@example.com")
    monkeypatch.setattr(settings, "SMTP_PASSWORD", "secret")
    monkeypatch.setattr(settings, "SMTP_FROM", "")
    monkeypatch.setattr(settings, "SMTP_SECURITY", "ssl")

    subject, text, html = build_verification_email("to@example.com", "123456", 10, "register")

    server = mock.MagicMock()
    smtp_ctx = mock.MagicMock()
    smtp_ctx.__enter__.return_value = server

    with mock.patch.object(email_service.smtplib, "SMTP_SSL", return_value=smtp_ctx):
        send_email("to@example.com", subject, text, html)

    server.login.assert_called_once_with("sender@example.com", "secret")
    server.send_message.assert_called_once()
    msg = server.send_message.call_args[0][0]
    assert msg["To"] == "to@example.com"
    assert msg["Subject"] == subject
    # 顶层是 multipart（text + html 两段），构建过程不得抛 set_charset 异常
    assert msg.is_multipart()
    parts = list(msg.iter_parts())
    assert len(parts) == 2
    assert parts[0].get_content_type() == "text/plain"
    assert parts[1].get_content_type() == "text/html"
    # 中文内容按 UTF-8 编码，可往返还原
    assert "123456" in parts[0].get_content()
    assert "123456" in parts[1].get_content()


def test_send_email_starttls_mode(monkeypatch):
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.example.com")
    monkeypatch.setattr(settings, "SMTP_PORT", 587)
    monkeypatch.setattr(settings, "SMTP_USER", "sender@example.com")
    monkeypatch.setattr(settings, "SMTP_PASSWORD", "secret")
    monkeypatch.setattr(settings, "SMTP_SECURITY", "starttls")

    server = mock.MagicMock()
    smtp_ctx = mock.MagicMock()
    smtp_ctx.__enter__.return_value = server

    with mock.patch.object(email_service.smtplib, "SMTP", return_value=smtp_ctx):
        send_email("to@example.com", "subject", "body", None)

    server.starttls.assert_called_once()
    server.login.assert_called_once_with("sender@example.com", "secret")
    server.send_message.assert_called_once()


def test_send_email_unavailable_in_production_without_smtp(monkeypatch):
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "SMTP_HOST", "")
    monkeypatch.setattr(settings, "SMTP_USER", "")
    with pytest.raises(EmailServiceUnavailable):
        send_email("a@b.com", "subject", "body", None)


def _smtp_settings(monkeypatch, security: str) -> None:
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.example.com")
    monkeypatch.setattr(settings, "SMTP_PORT", 465)
    monkeypatch.setattr(settings, "SMTP_USER", "sender@example.com")
    monkeypatch.setattr(settings, "SMTP_PASSWORD", "secret")
    monkeypatch.setattr(settings, "SMTP_SECURITY", security)


def test_send_email_ssl_verifies_certificate(monkeypatch):
    """SSL 分支必须传入校验证书的 context（不传时 stdlib 默认 CERT_NONE）。"""
    import ssl

    _smtp_settings(monkeypatch, "ssl")
    smtp_ctx = mock.MagicMock()
    smtp_ctx.__enter__.return_value = mock.MagicMock()

    with mock.patch.object(
        email_service.smtplib, "SMTP_SSL", return_value=smtp_ctx
    ) as smtp_ssl:
        send_email("to@example.com", "subject", "body", None)

    context = smtp_ssl.call_args.kwargs["context"]
    assert isinstance(context, ssl.SSLContext)
    assert context.verify_mode == ssl.CERT_REQUIRED
    assert context.check_hostname is True


def test_send_email_starttls_verifies_certificate(monkeypatch):
    import ssl

    _smtp_settings(monkeypatch, "starttls")
    server = mock.MagicMock()
    smtp_ctx = mock.MagicMock()
    smtp_ctx.__enter__.return_value = server

    with mock.patch.object(email_service.smtplib, "SMTP", return_value=smtp_ctx):
        send_email("to@example.com", "subject", "body", None)

    context = server.starttls.call_args.kwargs["context"]
    assert isinstance(context, ssl.SSLContext)
    assert context.verify_mode == ssl.CERT_REQUIRED


def test_send_email_refuses_plaintext_with_credentials(monkeypatch):
    """配置了凭据时绝不允许明文连接（否则链路上的中间人可窃取邮箱授权码）。"""
    _smtp_settings(monkeypatch, "none")
    server = mock.MagicMock()
    smtp_ctx = mock.MagicMock()
    smtp_ctx.__enter__.return_value = server

    with mock.patch.object(email_service.smtplib, "SMTP", return_value=smtp_ctx):
        with pytest.raises(email_service.EmailServiceError) as exc:
            send_email("to@example.com", "subject", "body", None)

    assert "SMTP_SECURITY" in str(exc.value)
    server.login.assert_not_called()
    server.send_message.assert_not_called()
