"""Helpers both ECS worker entrypoints need, in one place.

`worker.py` and `export_worker.py` are separate entrypoints that share a
database, a notification table and a connection-string format, and each used to
carry its own copy of these three functions under a "Mirrored in <the other
file> — keep both copies in sync" comment. That comment is the anti-pattern
this repo has a rule about (root CLAUDE.md: "two lists that must agree = one
declaration + a test"), and it had already failed quietly: by 2026-08-29 the
copies had drifted in three places — `str | None` vs `Optional[str]`, and two
docstrings — with nothing to notice.

None of that drift changed behaviour, which is exactly why it survived. One
declaration removes the question.

DELIBERATELY NOT HERE:
  - `update_status` — the two copies must differ. `topo_jobs` has an
    `updated_at` column and `topo_export_jobs` does not, so a shared version
    would break every export status flip (review finding STP-008).
  - `delete_s3_prefix_best_effort` — reads each worker's own module-level
    `BUCKET`, `s3` and `log`, so sharing it means threading three arguments
    through for two copies that differ only in a docstring. Guarded against
    real drift by a test instead (`tests/test_worker_common.py`).
"""
import json
import os
from typing import Optional
from urllib.parse import quote


def compose_database_url() -> str:
    """Compose a Postgres connection string from discrete DB_* env vars.

    User and password are URL-quoted (safe="") because RDS-generated passwords
    contain characters like "!" that aren't valid unescaped in a URL. Fails
    loud, listing missing var NAMES only (never values).
    """
    host = os.environ.get("DB_HOST")
    name = os.environ.get("DB_NAME")
    user = os.environ.get("DB_USER")
    password = os.environ.get("DB_PASSWORD")
    port = os.environ.get("DB_PORT", "5432")

    missing = [
        var_name
        for var_name, value in (
            ("DB_HOST", host),
            ("DB_NAME", name),
            ("DB_USER", user),
            ("DB_PASSWORD", password),
        )
        if not value
    ]
    if missing:
        raise RuntimeError(
            f"Missing required environment variables for database connection: {', '.join(missing)}"
        )

    return (
        f"postgresql://{quote(user, safe='')}:{quote(password, safe='')}"
        f"@{host}:{port}/{name}"
    )


def create_notification(conn, user_id: str, notif_type: str, payload: dict):
    import uuid as _uuid
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO notifications (id, user_id, type, payload, read, created_at) "
            "VALUES (%s, %s, %s, %s, false, NOW())",
            (str(_uuid.uuid4()), user_id, notif_type, json.dumps(payload)),
        )
    conn.commit()


def get_user_email(conn, user_id: str) -> Optional[str]:
    with conn.cursor() as cur:
        cur.execute("SELECT email FROM users WHERE id = %s", (user_id,))
        row = cur.fetchone()
    return row["email"] if row else None
