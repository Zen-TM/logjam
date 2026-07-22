"""
push_send.py
------------
Expo push notifications, shared by worker.py and export_worker.py — the Python
mirror of api/src/services/push.ts (the Expo push API is one HTTPS POST, no SDK
needed). Sends are best-effort — callers create the in-app notification first,
so a failure here is logged and swallowed, never raised.

PRIVACY (hard rule): push payloads transit Apple/Google/Expo servers in
plaintext. NEVER put canyon names, coordinates, usernames, or any free text in
a push. Titles are static per type; data carries the notification type and
opaque IDs only. Keep PUSH_TITLES and ALLOWED_DATA_KEYS in sync with
api/src/services/push.ts.
"""

import logging

import requests

log = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
EXPO_PUSH_BATCH_LIMIT = 100

# Static, generic titles — no interpolation, ever.
PUSH_TITLES = {
    "friend_request": "New friend request",
    "friend_request_accepted": "Friend request accepted",
    "canyon_shared": "A canyon was shared with you",
    "topo_complete": "Topo processing complete",
    "topo_failed": "Topo processing failed",
    "topo_export_complete": "Topo export finished",
    "topo_export_skipped": "Auto-export skipped",
    "geo_pdf_complete": "GeoPDF finished",
}
GENERIC_TITLE = "Logjam notification"

ALLOWED_DATA_KEYS = {
    "type",
    "notificationId",
    "friendshipId",
    "canyonId",
    "jobId",
    "exportId",
    "geoPdfJobId",
}


def build_push_messages(tokens: list[str], data: dict) -> list[dict]:
    """Pure builder (unit-tested): one message per token, static title,
    whitelisted opaque-ID data only. Raises on a non-whitelisted key so a
    call site can't smuggle free text through."""
    for key in data:
        if key not in ALLOWED_DATA_KEYS:
            raise ValueError(f"Push data key not allowed: {key}")
    title = PUSH_TITLES.get(data.get("type", ""), GENERIC_TITLE)
    return [
        {
            "to": token,
            "title": title,
            "data": data,
            "sound": "default",
            "priority": "default",
        }
        for token in tokens
    ]


def tokens_to_prune(tokens: list[str], tickets: list[dict]) -> list[str]:
    """Tokens whose ticket reports DeviceNotRegistered (positional). Pure."""
    stale = []
    for i, token in enumerate(tokens):
        ticket = tickets[i] if i < len(tickets) else None
        if ticket and (ticket.get("details") or {}).get("error") == "DeviceNotRegistered":
            stale.append(token)
    return stale


def send_push(conn, user_id: str, data: dict) -> None:
    """Send a push to every registered device of a user. Best-effort: logs and
    swallows every failure. Prunes DeviceNotRegistered tokens."""
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT token FROM device_tokens WHERE user_id = %s", (user_id,)
            )
            rows = cur.fetchall()
        tokens = [row["token"] for row in rows]
        if not tokens:
            return
        messages = build_push_messages(tokens, data)
        for start in range(0, len(messages), EXPO_PUSH_BATCH_LIMIT):
            batch_tokens = tokens[start : start + EXPO_PUSH_BATCH_LIMIT]
            response = requests.post(
                EXPO_PUSH_URL,
                json=messages[start : start + EXPO_PUSH_BATCH_LIMIT],
                timeout=15,
            )
            if not response.ok:
                log.warning("push send failed: HTTP %s", response.status_code)
                continue
            tickets = (response.json() or {}).get("data", [])
            stale = tokens_to_prune(batch_tokens, tickets)
            if stale:
                with conn.cursor() as cur:
                    cur.execute(
                        "DELETE FROM device_tokens WHERE token = ANY(%s)", (stale,)
                    )
                conn.commit()
                log.info("pruned %d stale push tokens", len(stale))
    except Exception as exc:  # noqa: BLE001 — best-effort by design
        # Log the class only — no free text that could carry payload fragments.
        log.warning("push send error: %s", type(exc).__name__)
