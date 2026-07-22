"""Privacy-invariant tests for push_send.py — mirrors api push.unit.test.ts.

Pure-logic only (build_push_messages / tokens_to_prune); the HTTP/DB paths are
best-effort plumbing exercised by the worker integration runbooks.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import _native_stub  # noqa: F401,E402 — stubs requests-adjacent libs when absent

from push_send import (  # noqa: E402
    ALLOWED_DATA_KEYS,
    PUSH_TITLES,
    build_push_messages,
    tokens_to_prune,
)


class TestBuildPushMessages(unittest.TestCase):
    def test_one_message_per_token_with_static_title(self):
        messages = build_push_messages(
            ["ExponentPushToken[a]", "ExponentPushToken[b]"],
            {"type": "topo_complete", "jobId": "j1"},
        )
        self.assertEqual(len(messages), 2)
        self.assertEqual(messages[0]["title"], "Topo processing complete")
        self.assertEqual(messages[0]["data"], {"type": "topo_complete", "jobId": "j1"})
        self.assertNotIn("body", messages[0])

    def test_titles_are_static_no_placeholders(self):
        for title in PUSH_TITLES.values():
            self.assertNotRegex(title, r"[{}$%]")

    def test_unknown_type_falls_back_to_generic(self):
        [message] = build_push_messages(["t"], {"type": "future_type"})
        self.assertEqual(message["title"], "Logjam notification")

    def test_rejects_non_whitelisted_keys(self):
        with self.assertRaisesRegex(ValueError, "canyonName"):
            build_push_messages(["t"], {"type": "canyon_shared", "canyonName": "Secret"})
        with self.assertRaisesRegex(ValueError, "latitude"):
            build_push_messages(["t"], {"type": "canyon_shared", "latitude": -33.7})

    def test_whitelist_matches_node_side(self):
        # Keep in sync with api/src/services/push.ts ALLOWED_DATA_KEYS.
        self.assertEqual(
            ALLOWED_DATA_KEYS,
            {
                "type",
                "notificationId",
                "friendshipId",
                "canyonId",
                "jobId",
                "exportId",
                "geoPdfJobId",
            },
        )


class TestTokensToPrune(unittest.TestCase):
    def test_prunes_device_not_registered_positionally(self):
        tokens = ["a", "b", "c"]
        tickets = [
            {"status": "ok"},
            {"status": "error", "details": {"error": "DeviceNotRegistered"}},
            {"status": "error", "details": {"error": "MessageRateExceeded"}},
        ]
        self.assertEqual(tokens_to_prune(tokens, tickets), ["b"])

    def test_missing_tickets_are_ignored(self):
        self.assertEqual(tokens_to_prune(["a", "b"], [{"status": "ok"}]), [])


if __name__ == "__main__":
    unittest.main()
