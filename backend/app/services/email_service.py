"""Email sending service — SMTP via the standard library (zero new deps).

Security / operational rules:
- Codes are NEVER logged or returned to the client in production.
- In development (``ENVIRONMENT == "development"``) with SMTP unconfigured,
  the code is printed to the server log and returned in the ``dev_code``
  field of the API response so the flow can be tested offline.
- In production with SMTP unconfigured, ``send_email`` raises
  ``EmailServiceUnavailable`` and the caller maps it to a 503.

The SMTP connection is established per message (simple, stateless, fine for
low-volume verification mail).
"""

import html
import logging
import smtplib
from email.message import EmailMessage

from app.config import settings

logger = logging.getLogger(__name__)


class EmailServiceError(Exception):
    """Base error for email sending failures."""


class EmailServiceUnavailable(EmailServiceError):
    """SMTP is not configured (production) — cannot send mail."""


def smtp_configured() -> bool:
    """True when an SMTP host is configured."""
    return bool(settings.SMTP_HOST and settings.SMTP_USER)


def send_email(to: str, subject: str, text_body: str, html_body: str | None = None) -> None:
    """Send an email via the configured SMTP server.

    Raises:
        EmailServiceUnavailable: SMTP not configured (and not dev console mode).
        EmailServiceError: SMTP connection / send failure.
    """
    if not smtp_configured():
        if settings.ENVIRONMENT.lower() == "development":
            # Console fallback: log the message so developers can read it.
            logger.warning(
                "[EMAIL CONSOLE] SMTP 未配置（开发兜底）→ 收件人 %s\n主题: %s\n正文:\n%s",
                to,
                subject,
                text_body,
            )
            return
        raise EmailServiceUnavailable(
            "SMTP is not configured — set SMTP_HOST/SMTP_USER/SMTP_PASSWORD "
            "to enable email delivery."
        )

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = settings.SMTP_FROM or settings.SMTP_USER
    msg["To"] = to
    msg.set_content(text_body)
    if html_body:
        msg.add_alternative(html_body, subtype="html")
    # NOTE: do NOT call msg.set_charset() here — after set_content/add_alternative
    # the payload is a multipart list and set_charset() raises (TypeError /
    # AttributeError on Python 3.13). set_content/add_alternative already assign
    # utf-8 to each part, so the message is fully UTF-8-capable as-is.

    security = (settings.SMTP_SECURITY or "ssl").lower()
    timeout = settings.SMTP_TIMEOUT

    try:
        if security == "ssl":
            with smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, timeout=timeout) as server:
                _authenticate(server)
                server.send_message(msg)
        else:
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=timeout) as server:
                if security == "starttls":
                    server.starttls()
                _authenticate(server)
                server.send_message(msg)
    except smtplib.SMTPException as exc:
        logger.error("SMTP send failed to %s: %s", to, exc)
        raise EmailServiceError(f"SMTP send failed: {exc}") from exc


def _authenticate(server: smtplib.SMTP) -> None:
    """Authenticate if credentials are provided (plain STARTTLS-less servers may not need it)."""
    if settings.SMTP_USER:
        server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)


def build_verification_email(
    to: str, code: str, ttl_minutes: int, purpose: str
) -> tuple[str, str, str]:
    """Build subject / text / html for a verification code email.

    Returns ``(subject, text_body, html_body)``.
    """
    if purpose == "reset_password":
        subject = "【外刊阅读】重置密码验证码"
        action_label = "重置您的密码"
    else:
        subject = "【外刊阅读】注册验证码"
        action_label = "完成账号注册"

    text_body = (
        f"您好，\n\n"
        f"您正在使用此邮箱{action_label}，您的验证码是：{code}\n\n"
        f"验证码 {ttl_minutes} 分钟内有效，请勿向他人泄露。\n"
        f"如非本人操作，请忽略此邮件。\n\n—— 外刊阅读"
    )

    safe_code = html.escape(code)
    html_body = f"""<!DOCTYPE html>
<html lang="zh-CN">
<body style="margin:0;padding:24px;background:#faf9f5;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #ece7e1;border-radius:12px;padding:32px;">
    <h2 style="margin:0 0 16px;color:#141413;font-size:18px;">外刊阅读 · {html.escape(action_label)}</h2>
    <p style="margin:0 0 20px;color:#5f5a52;font-size:14px;line-height:1.7;">
      您好，您正在使用此邮箱{html.escape(action_label)}。请输入以下验证码：
    </p>
    <div style="background:#faf9f5;border:1px dashed #cc785c;border-radius:8px;padding:16px;text-align:center;margin-bottom:20px;">
      <span style="font-size:28px;font-weight:600;letter-spacing:8px;color:#cc785c;">{safe_code}</span>
    </div>
    <p style="margin:0;color:#8a857d;font-size:12px;line-height:1.7;">
      验证码 {ttl_minutes} 分钟内有效，请勿向他人泄露。如非本人操作，请忽略此邮件。
    </p>
  </div>
</body>
</html>"""
    return subject, text_body, html_body
