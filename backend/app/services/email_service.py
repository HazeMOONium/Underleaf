import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import aiosmtplib

from app.core.config import get_settings

logger = logging.getLogger(__name__)


async def _send_email(to_email: str, subject: str, text_body: str, html_body: str) -> None:
    """Low-level helper that dispatches a single email via SMTP.

    Falls back to a dev-mode log line when SMTP_HOST is not configured so that
    local and CI environments work without an SMTP server.
    """
    settings = get_settings()

    if not settings.SMTP_HOST:
        logger.warning(
            "SMTP not configured — email (dev fallback):\n"
            "  To: %s\n  Subject: %s\n  Body: %s",
            to_email,
            subject,
            text_body,
        )
        return

    message = MIMEMultipart("alternative")
    message["Subject"] = subject
    message["From"] = settings.SMTP_FROM
    message["To"] = to_email
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
        logger.info("Email '%s' sent to %s", subject, to_email)
    except Exception as exc:
        logger.error("Failed to send email '%s' to %s: %s", subject, to_email, exc)


async def send_password_reset_email(to_email: str, reset_url: str) -> None:
    """Send a password-reset link to the given address."""
    settings = get_settings()

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

    await _send_email(to_email, "Reset your Underleaf password", text_body, html_body)


async def send_new_comment_email(
    to_email: str,
    project_title: str,
    file_path: str,
    line: int,
    content: str,
    commenter_email: str,
    project_url: str,
) -> None:
    """Notify a project owner that someone left a new comment on their project."""
    subject = f'New comment on "{project_title}"'
    text_body = (
        f'{commenter_email} commented on {file_path} (line {line}) in "{project_title}":\n\n'
        f"  {content}\n\n"
        f"View the project: {project_url}"
    )
    html_body = f"""<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;color:#333;max-width:480px;margin:auto;padding:24px">
  <h2 style="color:#1a7f4b">New comment on &ldquo;{project_title}&rdquo;</h2>
  <p><strong>{commenter_email}</strong> commented on
     <code>{file_path}</code> (line {line}):</p>
  <blockquote style="border-left:3px solid #1a7f4b;margin:12px 0;padding:8px 16px;
                     background:#f6fdf9;color:#555;font-style:italic">
    {content}
  </blockquote>
  <p>
    <a href="{project_url}"
       style="display:inline-block;padding:10px 20px;background:#1a7f4b;color:#fff;
              border-radius:6px;text-decoration:none;font-weight:600">
      View project
    </a>
  </p>
</body>
</html>"""
    await _send_email(to_email, subject, text_body, html_body)


async def send_comment_reply_email(
    to_email: str,
    project_title: str,
    file_path: str,
    line: int,
    replier_email: str,
    reply_content: str,
    original_content: str,
    project_url: str,
) -> None:
    """Notify a comment author that someone replied to their comment."""
    subject = f'New reply to your comment in "{project_title}"'
    text_body = (
        f"{replier_email} replied to your comment on {file_path} (line {line}) "
        f'in "{project_title}":\n\n'
        f"  Your comment: {original_content}\n\n"
        f"  Reply: {reply_content}\n\n"
        f"View the project: {project_url}"
    )
    html_body = f"""<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;color:#333;max-width:480px;margin:auto;padding:24px">
  <h2 style="color:#1a7f4b">New reply to your comment</h2>
  <p><strong>{replier_email}</strong> replied to your comment on
     <code>{file_path}</code> (line {line}) in &ldquo;{project_title}&rdquo;:</p>
  <p style="font-size:13px;color:#888">Your comment:</p>
  <blockquote style="border-left:3px solid #ccc;margin:4px 0 12px;padding:8px 16px;
                     color:#888;font-style:italic">
    {original_content}
  </blockquote>
  <p style="font-size:13px;color:#555">Reply:</p>
  <blockquote style="border-left:3px solid #1a7f4b;margin:4px 0 12px;padding:8px 16px;
                     background:#f6fdf9;color:#555;font-style:italic">
    {reply_content}
  </blockquote>
  <p>
    <a href="{project_url}"
       style="display:inline-block;padding:10px 20px;background:#1a7f4b;color:#fff;
              border-radius:6px;text-decoration:none;font-weight:600">
      View project
    </a>
  </p>
</body>
</html>"""
    await _send_email(to_email, subject, text_body, html_body)


async def send_comment_resolved_email(
    to_email: str,
    project_title: str,
    file_path: str,
    line: int,
    resolver_email: str,
    comment_content: str,
    project_url: str,
) -> None:
    """Notify a comment thread author that their thread was resolved."""
    subject = f'Comment resolved in "{project_title}"'
    text_body = (
        f"{resolver_email} resolved a comment thread on {file_path} (line {line}) "
        f'in "{project_title}":\n\n'
        f"  {comment_content}\n\n"
        f"View the project: {project_url}"
    )
    html_body = f"""<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;color:#333;max-width:480px;margin:auto;padding:24px">
  <h2 style="color:#1a7f4b">Comment resolved</h2>
  <p><strong>{resolver_email}</strong> resolved a comment thread on
     <code>{file_path}</code> (line {line}) in &ldquo;{project_title}&rdquo;:</p>
  <blockquote style="border-left:3px solid #aaa;margin:12px 0;padding:8px 16px;
                     color:#888;font-style:italic;text-decoration:line-through">
    {comment_content}
  </blockquote>
  <p>
    <a href="{project_url}"
       style="display:inline-block;padding:10px 20px;background:#1a7f4b;color:#fff;
              border-radius:6px;text-decoration:none;font-weight:600">
      View project
    </a>
  </p>
</body>
</html>"""
    await _send_email(to_email, subject, text_body, html_body)


async def send_verification_email(to_email: str, verify_url: str) -> None:
    """Send an email-verification link to a newly registered user.

    The link is valid for 24 hours and contains a single-use token stored in
    Redis under the key ``email_verify:{token}``.
    """
    text_body = (
        f"Welcome to Underleaf!\n\n"
        f"Please verify your email address by clicking the link below "
        f"(valid for 24 hours):\n\n"
        f"{verify_url}\n\n"
        f"If you didn't create an Underleaf account, you can safely ignore this email."
    )
    html_body = f"""<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;color:#333;max-width:480px;margin:auto;padding:24px">
  <h2 style="color:#1a7f4b">Welcome to Underleaf!</h2>
  <p>Please verify your email address to get started.</p>
  <p>
    <a href="{verify_url}"
       style="display:inline-block;padding:10px 20px;background:#1a7f4b;color:#fff;
              border-radius:6px;text-decoration:none;font-weight:600">
      Verify email address
    </a>
  </p>
  <p style="font-size:13px;color:#666">
    This link expires in 24 hours.
    If you didn't create an Underleaf account, you can safely ignore this email.
  </p>
</body>
</html>"""

    await _send_email(to_email, "Verify your Underleaf email address", text_body, html_body)
