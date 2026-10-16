"""Helpers both ECS worker entrypoints need, in one place.

`worker.py` and `export_worker.py` are separate entrypoints that share a
database, a notification table and a connection-string format.

DELIBERATELY NOT HERE:
  - `update_status` — the two copies must differ. `topo_jobs` has an
    `updated_at` column and `topo_export_jobs` does not, so a shared version
    would break every export status flip.
  - `delete_s3_prefix_best_effort` — reads each worker's own module-level
    `BUCKET`, `s3` and `log`, so sharing it means threading three arguments
    through for two copies that differ only in a docstring. Guarded against
    drift by a test instead (`tests/test_worker_common.py`).
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
