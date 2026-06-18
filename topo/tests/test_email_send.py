"""email_send.send_email no-op guard.

Pure-logic: with RESEND_API_KEY / EMAIL_FROM unset the helper must return
without importing or calling `resend` (mirrors the old `if not ses` guard so
local dev and unconfigured workers never crash). The real Resend send path runs
only in the worker container and is not exercised here.
"""
import importlib
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import _native_stub  # noqa: F401,E402


class TestSendEmailNoOp(unittest.TestCase):
    def _reload(self, api_key, email_from):
        for key, val in (("RESEND_API_KEY", api_key), ("EMAIL_FROM", email_from)):
            if val is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = val
        import email_send
        return importlib.reload(email_send)

    def test_no_op_when_both_unset(self):
        mod = self._reload(None, None)
        # Must not raise and must not require the `resend` package.
        self.assertIsNone(mod.send_email("u@example.com", "S", "T", "<p>T</p>"))

    def test_no_op_when_only_from_set(self):
        mod = self._reload(None, "noreply@x")
        self.assertIsNone(mod.send_email("u@example.com", "S", "T", "<p>T</p>"))

    def test_no_op_when_only_key_set(self):
        mod = self._reload("re_x", None)
        self.assertIsNone(mod.send_email("u@example.com", "S", "T", "<p>T</p>"))

    def tearDown(self):
        os.environ.pop("RESEND_API_KEY", None)
        os.environ.pop("EMAIL_FROM", None)


if __name__ == "__main__":
    unittest.main()
