import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import aiosmtplib

from app.core.config import get_settings

logger = logging.getLogger(__name__)


async def send_password_reset_email(to_email: str, reset_url: str) -> None:
    settings = get_settings()

    if not settings.SMTP_HOST:
        logger.warning(
            "SMTP not configured — password reset link (dev/self-hosted fallback):\n"
            "  To: %s\n  Reset URL: %s",
            to_email,
            reset_url,
        )
        return

    message = MIMEMultipart("alternative")
    message["Subject"] = "Reset your Underleaf password"
    message["From"] = settings.SMTP_FROM
    message["To"] = to_email

    text_body = (
        f"You requested a password reset for your Underleaf account.\n\n"
        f"Click the link below to set a new password (valid for "
        f"{settings.PASSWORD_RESET_EXPIRE_MINUTES} minutes):\n\n"
        f"{reset_url}\n\n"
        f"If you didn't request this, you can ignore this email."
    )
    html_body = f"""<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;color:#333;max-width:480px;margin:auto;padding:24px">
  <h2 style="color:#1a7f4b">Reset your Underleaf password</h2>
  <p>You requested a password reset for your Underleaf account.</p>
  <p>
    <a href="{reset_url}"
       style="display:inline-block;padding:10px 20px;background:#1a7f4b;color:#fff;
              border-radius:6px;text-decoration:none;font-weight:600">
      Reset password
    </a>
  </p>
  <p style="font-size:13px;color:#666">
    This link expires in {settings.PASSWORD_RESET_EXPIRE_MINUTES} minutes.
    If you didn't request a reset, you can safely ignore this email.
  </p>
</body>
</html>"""

    message.attach(MIMEText(text_body, "plain"))
    message.attach(MIMEText(html_body, "html"))

    try:
        await aiosmtplib.send(
            message,
            hostname=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            username=settings.SMTP_USER or None,
            password=settings.SMTP_PASSWORD or None,
            use_tls=settings.SMTP_TLS,
            timeout=10,
        )
        logger.info("Password reset email sent to %s", to_email)
    except Exception as exc:
        logger.error("Failed to send password reset email to %s: %s", to_email, exc)
