"""
email_send.py
-------------
Transactional email over SMTP, shared by worker.py and export_worker.py. Sends
are best-effort — callers create the in-app notification first, so a failure
here is logged and swallowed, never raised.

Env (SMTP_ENV_KEYS, the same names the API reads from shared/src/smtp.ts; any
one unset → send_email is a logged no-op):
  SMTP_HOST, SMTP_PORT - implicit TLS on 465, required STARTTLS on any other.
  SMTP_USER            - SMTP login.
  SMTP_PASSWORD        - SMTP password.
  EMAIL_FROM           - verified sender, e.g. noreply@notifications.logjamnsw.com.
Optional:
  SMTP_CA_CERT         - base64 PEM of the only CA to trust instead of the
                         public roots. Local dev's Mailpit; unset in prod.
"""

import base64
import logging
import os
import smtplib
import ssl
from email.message import EmailMessage

log = logging.getLogger(__name__)

SMTP_ENV_KEYS = ("SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM")
SMTP_CA_ENV_KEY = "SMTP_CA_CERT"
IMPLICIT_TLS_PORT = 465
TIMEOUT_S = 30


def send_email(to_email: str, subject: str, text: str, html: str) -> None:
    """Send one transactional email. No-op (logged) when any of SMTP_ENV_KEYS is
    unset so unconfigured envs degrade quietly instead of crashing."""
    config = {key: os.environ.get(key, "") for key in SMTP_ENV_KEYS}
    if not all(config.values()):
        log.info("Email skipped (SMTP config unset)")
        return
    try:
        message = EmailMessage()
        message["From"] = config["EMAIL_FROM"]
        message["To"] = to_email
        message["Subject"] = subject
        message.set_content(text)
        message.add_alternative(html, subtype="html")

        ca = os.environ.get(SMTP_CA_ENV_KEY)
        context = ssl.create_default_context(
            cadata=base64.b64decode(ca).decode() if ca else None
        )
        host, port = config["SMTP_HOST"], int(config["SMTP_PORT"])
        implicit_tls = port == IMPLICIT_TLS_PORT
        smtp = (
            smtplib.SMTP_SSL(host, port, timeout=TIMEOUT_S, context=context)
            if implicit_tls
            else smtplib.SMTP(host, port, timeout=TIMEOUT_S)
        )
        with smtp:
            if not implicit_tls:
                # Raises on a server that won't upgrade, before the login or
                # the message leave. Guard: tests/test_email_send.py.
                smtp.starttls(context=context)
            smtp.login(config["SMTP_USER"], config["SMTP_PASSWORD"])
            smtp.send_message(message)
    except Exception as e:
        # The class only: smtplib's messages quote the recipient
        # (tests/test_email_send.py).
        log.warning(f"Failed to send email: {type(e).__name__}")


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
