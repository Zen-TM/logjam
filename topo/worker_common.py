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

# What the owner of a job too big for the task's memory reads: from sharpen.py,
# which refuses one in advance, and from worker.py, which maps an
# out-of-memory kill of the job's own process to it. A kill of one of its
# children (pdal, a pool worker) still reads as the generic failure.
TOO_BIG = "This area was too big to process. Try a smaller one."

# The brain's Postgres certificate, which the worker image carries (Dockerfile).
BRAIN_CA_PATH = "/app/brain-ca.pem"


def compose_database_url() -> str:
    """Compose a Postgres connection string from discrete DB_* env vars.

    User and password are URL-quoted (safe="") because generated passwords
    can contain characters like "!" that aren't valid unescaped in a URL. Fails
    loud, listing missing var NAMES only (never values).

    A connect timeout and TCP keepalives are always set, so a replaced database
    host does not leave a worker on a dead socket. The connection is always
    `sslmode=verify-full` against DATABASE_SSL_CA (the path the API's own client
    also reads), or the brain's certificate the image carries when it is unset,
    so a worker never connects in the clear and a missing file stops it at
    connect ("root certificate file ... does not exist"). Only
    DATABASE_SSL=disable (local workers, whose Postgres is plain TCP) drops it.
    Guard: tests/test_worker_helpers.py.
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

    params = [
        "connect_timeout=10",
        "keepalives=1",
        "keepalives_idle=30",
        "keepalives_interval=10",
        "keepalives_count=3",
    ]
    if os.environ.get("DATABASE_SSL") != "disable":
        ca = os.environ.get("DATABASE_SSL_CA") or BRAIN_CA_PATH
        params += ["sslmode=verify-full", f"sslrootcert={quote(ca, safe='/')}"]

    return (
        f"postgresql://{quote(user, safe='')}:{quote(password, safe='')}"
        f"@{host}:{port}/{name}?{'&'.join(params)}"
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
