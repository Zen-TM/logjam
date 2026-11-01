"""email_send.send_email over a real SMTP server on loopback: the no-op guard,
TLS, and the failure log. Also that it reads the keys shared/src/smtp.ts
declares, so the two senders can't drift.
"""

import base64
import logging
import os
import re
import socket
import ssl
import sys
import unittest
from email import message_from_bytes, policy
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import _native_stub  # noqa: F401,E402

from aiosmtpd.controller import Controller  # noqa: E402
from aiosmtpd.smtp import AuthResult  # noqa: E402

import email_send  # noqa: E402

_ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
_CERT = os.path.join(_ROOT, "infra", "mailpit", "dev-tls-cert.pem")
_KEY = os.path.join(_ROOT, "infra", "mailpit", "dev-tls-key.pem")


class _Inbox:
    def __init__(self):
        self.envelopes = []

    async def handle_DATA(self, server, session, envelope):
        self.envelopes.append(envelope)
        return "250 OK"


class _RefusingInbox(_Inbox):
    async def handle_RCPT(self, server, session, envelope, address, rcpt_options):
        return f"550 no such mailbox {address}"


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class SmtpTestCase(unittest.TestCase):
    def setUp(self):
        with open(_CERT, "rb") as f:
            ca = base64.b64encode(f.read()).decode()
        env = mock.patch.dict(
            os.environ,
            {
                "SMTP_HOST": "localhost",
                "SMTP_USER": "resend",
                "SMTP_PASSWORD": "re_x",
                "EMAIL_FROM": "noreply@example.com",
                "SMTP_CA_CERT": ca,
            },
        )
        env.start()
        self.addCleanup(env.stop)

    def serve(self, inbox, tls=True):
        kwargs = {}
        if tls:
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(_CERT, _KEY)
            kwargs = {"tls_context": context, "require_starttls": True}
        port = _free_port()
        os.environ["SMTP_PORT"] = str(port)
        controller = Controller(
            inbox,
            hostname="127.0.0.1",
            port=port,
            authenticator=lambda *args: AuthResult(success=True),
            auth_require_tls=False,
            **kwargs,
        )
        controller.start()
        self.addCleanup(controller.stop)


class TestSend(SmtpTestCase):
    def test_delivers_over_starttls(self):
        inbox = _Inbox()
        self.serve(inbox)
        email_send.send_email(
            "u@example.com", "Topo map ready — Logjam", "T", "<p>T</p>"
        )
        self.assertEqual(len(inbox.envelopes), 1)
        envelope = inbox.envelopes[0]
        self.assertEqual(envelope.mail_from, "noreply@example.com")
        self.assertEqual(envelope.rcpt_tos, ["u@example.com"])
        message = message_from_bytes(envelope.content, policy=policy.default)
        self.assertEqual(message["Subject"], "Topo map ready — Logjam")
        self.assertEqual(message.get_body(("plain",)).get_content().strip(), "T")
        self.assertEqual(message.get_body(("html",)).get_content().strip(), "<p>T</p>")

    # Mutation that turns it red: dropping smtp.starttls(). The login and the
    # message then go out in the clear.
    def test_refuses_a_server_that_offers_no_tls(self):
        inbox = _Inbox()
        self.serve(inbox, tls=False)
        with self.assertLogs("email_send", logging.WARNING) as logs:
            email_send.send_email("u@example.com", "S", "T", "<p>T</p>")
        self.assertEqual(inbox.envelopes, [])
        self.assertIn("SMTPNotSupportedError", logs.output[0])

    # Mutation that turns it red: a context with verify_mode = ssl.CERT_NONE.
    def test_refuses_a_certificate_no_trusted_ca_signed(self):
        inbox = _Inbox()
        self.serve(inbox)
        del os.environ["SMTP_CA_CERT"]
        with self.assertLogs("email_send", logging.WARNING):
            email_send.send_email("u@example.com", "S", "T", "<p>T</p>")
        self.assertEqual(inbox.envelopes, [])

    def test_implicit_tls_on_465(self):
        os.environ["SMTP_PORT"] = "465"
        with mock.patch("smtplib.SMTP_SSL") as smtp_ssl:
            email_send.send_email("u@example.com", "S", "T", "<p>T</p>")
        self.assertIsInstance(smtp_ssl.call_args.kwargs["context"], ssl.SSLContext)
        smtp_ssl.return_value.send_message.assert_called_once()

    # Mutation that turns it red: logging {e} instead of type(e).__name__.
    def test_failure_log_has_the_class_and_no_recipient(self):
        self.serve(_RefusingInbox())
        with self.assertLogs("email_send", logging.WARNING) as logs:
            email_send.send_email("u@example.com", "S", "T", "<p>T</p>")
        self.assertIn("SMTPRecipientsRefused", logs.output[0])
        self.assertNotIn("u@example.com", logs.output[0])

    def test_no_op_when_any_key_is_unset(self):
        os.environ["SMTP_PORT"] = "587"
        for key in email_send.SMTP_ENV_KEYS:
            with mock.patch.dict(os.environ):
                del os.environ[key]
                with mock.patch("smtplib.SMTP") as smtp:
                    email_send.send_email("u@example.com", "S", "T", "<p>T</p>")
                smtp.assert_not_called()


class TestConfigParity(unittest.TestCase):
    def setUp(self):
        with open(os.path.join(_ROOT, "shared", "src", "smtp.ts")) as f:
            self.shared = f.read()

    # Mutation that turns it red: renaming a key in email_send.py or in
    # shared/src/smtp.ts alone.
    def test_reads_the_keys_shared_declares(self):
        block = re.search(r"SMTP_ENV_KEYS = \[(.*?)\]", self.shared, re.S).group(1)
        self.assertEqual(email_send.SMTP_ENV_KEYS, tuple(re.findall(r'"(\w+)"', block)))
        ca = re.search(r'SMTP_CA_ENV_KEY = "(\w+)"', self.shared).group(1)
        self.assertEqual(email_send.SMTP_CA_ENV_KEY, ca)

    # Mutation that turns it red: dropping SMTP_HOST from a task definition,
    # which would silently stop that worker's email.
    def test_every_sending_task_definition_sets_them(self):
        with open(
            os.path.join(_ROOT, "infra", "terraform", "envs", "prod", "ecs.tf")
        ) as f:
            ecs = f.read()
        for task in ("api_script", "topo_worker", "topo_export_worker"):
            block = re.search(
                rf'"aws_ecs_task_definition" "{task}" \{{.*?\n\}}', ecs, re.S
            ).group(0)
            for key in email_send.SMTP_ENV_KEYS:
                self.assertIn(f'"{key}"', block, task)


if __name__ == "__main__":
    unittest.main()
