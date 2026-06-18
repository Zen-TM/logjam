"""
email_send.py
-------------
Transactional email via Resend, shared by worker.py and export_worker.py.

Replaces the previous boto3 SES path: AWS SES production access was denied, so
the app moved to Resend, which needs only DNS domain verification. Sends are
best-effort — callers create the in-app notification first, so a failure here is
logged and swallowed, never raised.

Env:
  RESEND_API_KEY  - Resend API key. Unset → send_email is a logged no-op.
  EMAIL_FROM      - verified sender, e.g. noreply@notifications.logjamnsw.com.
                    Unset → send_email is a logged no-op.
"""

import logging
import os

log = logging.getLogger(__name__)

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
EMAIL_FROM = os.environ.get("EMAIL_FROM", "")


def send_email(to_email: str, subject: str, text: str, html: str) -> None:
    """Send one transactional email. No-op (logged) when RESEND_API_KEY or
    EMAIL_FROM is unset — mirrors the old `if not ses` guard so local dev and
    misconfigured envs degrade quietly instead of crashing. `resend` is imported
    lazily so pure-logic tests on the dev host don't need the package."""
    if not RESEND_API_KEY or not EMAIL_FROM:
        log.info("Email skipped (RESEND_API_KEY/EMAIL_FROM unset)")
        return
    try:
        import resend

        resend.api_key = RESEND_API_KEY
        resend.Emails.send(
            {
                "from": EMAIL_FROM,
                "to": [to_email],
                "subject": subject,
                "text": text,
                "html": html,
            }
        )
    except Exception as e:
        log.warning(f"Failed to send email: {e}")


def wants_email(conn, user_id: str, key: str) -> bool:
    """Read users.ui_preferences.notifications[key]; default True if absent.
    Returns False only when the user row is missing or the pref is explicitly
    False (defensive against corrupt/partial JSON)."""
    with conn.cursor() as cur:
        cur.execute("SELECT ui_preferences FROM users WHERE id = %s", (user_id,))
        row = cur.fetchone()
    if not row:
        return False
    prefs = row["ui_preferences"] or {}
    notifications = prefs.get("notifications") if isinstance(prefs, dict) else None
    if not isinstance(notifications, dict):
        return True
    value = notifications.get(key)
    return True if not isinstance(value, bool) else value
