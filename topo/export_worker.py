"""
export_worker.py
----------------
ECS Fargate export worker. Processes a single TopoExportJob then exits.

Reads the export-job ID from EXPORT_JOB_ID, fetches the source TopoJob's
outputs from S3 (COGs for raster layers, raw GeoJSONs for vectors, vector
PMTiles where needed), dispatches to the right renderer for the requested
{format, bundling, layers}, uploads the artefact to:
    s3://$S3_BUCKET_TOPO/exports/<exportJobId>/<filename>
and emails the user a download link via SES.

Required env:
    EXPORT_JOB_ID       UUID of the TopoExportJob row
    S3_BUCKET_TOPO      bucket holding source outputs + result key
    DB_HOST, DB_NAME, DB_USER, DB_PASSWORD
                        Postgres connection parts (DB_PORT optional, default
                        5432). DB_USER/DB_PASSWORD are ECS-secrets-injected
                        from the RDS-managed Secrets Manager secret; the
                        connection string is composed at import time (see
                        compose_database_url below).
Optional env:
    SES_FROM_EMAIL      verified SES sender (skips email if unset)
    FRONTEND_URL        for the deep-link in the email body
    AWS_REGION          default ap-southeast-2
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import quote

import boto3
import psycopg2
import psycopg2.extras

from renderers import (
    RenderContext,
    RenderError,
    render_mbtiles,
    render_geotiff,
    render_gpkg,
    render_geojson,
    render_gpx,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("export_worker")

_PATH_RE = re.compile(r"(/[^\s:'\"]+)+")


def _scrub_paths(message: str) -> str:
    """Strip absolute filesystem paths (temp dirs, internal files) from a
    user-facing error so subprocess stderr can't leak /tmp/... or /app/... into
    the failure email or the notification shown in the dialog. The
    human-readable prefix (e.g. 'tippecanoe (features) failed:') survives."""
    return _PATH_RE.sub("<path>", message)


def compose_database_url() -> str:
    """Compose a Postgres connection string from discrete DB_* env vars.

    Mirrored in worker.py — keep both copies in sync. User and password are
    URL-quoted (safe="") because RDS-generated passwords contain characters
    like "!" that aren't valid unescaped in a URL. Fails loud, listing
    missing var NAMES only (never values).
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


AWS_REGION   = os.environ.get("AWS_REGION", "ap-southeast-2")
BUCKET       = os.environ["S3_BUCKET_TOPO"]
DATABASE_URL = compose_database_url()
SES_FROM     = os.environ.get("SES_FROM_EMAIL", "")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "")
EXPORT_JOB_ID = os.environ["EXPORT_JOB_ID"]

s3  = boto3.client("s3",  region_name=AWS_REGION)
ses = boto3.client("ses", region_name=AWS_REGION) if SES_FROM else None


def db_connect():
    return psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)


def get_export_job(conn, export_job_id: str) -> dict:
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM topo_export_jobs WHERE id = %s", (export_job_id,))
        row = cur.fetchone()
    if not row:
        raise RuntimeError(f"TopoExportJob {export_job_id} not found")
    return dict(row)


def get_source_jobs(conn, source_job_ids: list[str]) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, user_id, status, name, s3_output_keys, footprint "
            "FROM topo_jobs WHERE id = ANY(%s)",
            (source_job_ids,),
        )
        rows = cur.fetchall() or []
    return [dict(r) for r in rows]


def update_status(conn, export_job_id: str, status: str, storage_delta_bytes: int = 0,
                  expected_status: Optional[str] = None, **kwargs) -> int:
    """Update the export row's status and optional extra columns. Returns rows
    updated.

    If storage_delta_bytes is non-zero, the owner's storage_used_bytes is
    incremented in the SAME transaction/commit as the status update — the
    two-commit window worker.py already closed (ARCH-003): a crash between a
    `completed` commit and a separate storage commit would leave a
    downloadable export whose bytes were never quota-accounted.

    With expected_status the UPDATE is guarded (`AND status = %s`), making
    transitions write-once (Design L1): a reaped/deleted export matches 0
    rows, the storage charge is SKIPPED, and the caller must self-clean and
    skip notification/email.
    """
    set_clauses = ["status = %s"]
    values: list = [status]
    for col, val in kwargs.items():
        set_clauses.append(f"{col} = %s")
        values.append(val)
    values.append(export_job_id)
    where = "WHERE id = %s"
    if expected_status is not None:
        where += " AND status = %s"
        values.append(expected_status)
    with conn.cursor() as cur:
        cur.execute(
            f"UPDATE topo_export_jobs SET {', '.join(set_clauses)} {where}",
            values,
        )
        updated = cur.rowcount
        if updated and storage_delta_bytes:
            cur.execute(
                "UPDATE users SET storage_used_bytes = storage_used_bytes + %s"
                " WHERE id = (SELECT user_id FROM topo_export_jobs WHERE id = %s)",
                (storage_delta_bytes, export_job_id),
            )
    conn.commit()
    return updated


def delete_s3_prefix_best_effort(prefix: str):
    """Best-effort delete of every object under prefix (reaped-export
    self-clean). Never raises — the objects are unreferenced either way and
    the account-delete prefix sweep is the backstop."""
    try:
        paginator = s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=BUCKET, Prefix=prefix):
            keys = [{"Key": obj["Key"]} for obj in page.get("Contents", [])]
            if keys:
                s3.delete_objects(Bucket=BUCKET, Delete={"Objects": keys})
        log.info(f"Cleaned up s3://{BUCKET}/{prefix}")
    except Exception as e:
        log.warning(f"Best-effort cleanup of {prefix} failed: {e}")


def get_user_email(conn, user_id: str) -> Optional[str]:
    with conn.cursor() as cur:
        cur.execute("SELECT email FROM users WHERE id = %s", (user_id,))
        row = cur.fetchone()
    return row["email"] if row else None


def create_notification(conn, user_id: str, notif_type: str, payload: dict):
    import uuid as _uuid
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO notifications (id, user_id, type, payload, read, created_at) "
            "VALUES (%s, %s, %s, %s, false, NOW())",
            (str(_uuid.uuid4()), user_id, notif_type, json.dumps(payload)),
        )
    conn.commit()


def send_completion_email(to_email: str, export_job_id: str, format_: str, ok: bool, error: Optional[str]):
    if not ses or not FRONTEND_URL:
        return
    base = FRONTEND_URL.rstrip("/")
    if ok:
        subject = f"Topo export ready — {format_.upper()}"
        text = (
            "Your topo export is ready.\n\n"
            f"Open Logjam to download: {base}/?export={export_job_id}\n\n"
            "Downloads expire after 24 hours; re-open the export dialog to "
            "re-presign if needed."
        )
        html = (
            f"<p>Your topo export is ready.</p>"
            f'<p><a href="{base}/?export={export_job_id}">Open Logjam to download</a></p>'
            f"<p>Downloads expire after 24 hours; re-open the export dialog to "
            f"re-presign if needed.</p>"
        )
    else:
        subject = f"Topo export failed — {format_.upper()}"
        safe_error = error or "Unknown error"
        text = f"Your topo export failed.\n\n{safe_error}\n\nOpen Logjam to retry: {base}"
        html = (
            f"<p>Your topo export failed.</p>"
            f"<p><strong>{safe_error}</strong></p>"
            f'<p><a href="{base}">Open Logjam to retry</a></p>'
        )
    try:
        ses.send_email(
            Source=SES_FROM,
            Destination={"ToAddresses": [to_email]},
            Message={
                "Subject": {"Data": subject},
                "Body":    {"Text": {"Data": text}, "Html": {"Data": html}},
            },
        )
    except Exception as e:
        log.warning(f"Failed to send export email: {e}")


def main():
    log.info(f"Export worker started — job {EXPORT_JOB_ID}")
    conn = db_connect()

    try:
        export_job = get_export_job(conn, EXPORT_JOB_ID)
    except Exception as e:
        log.error(f"Could not load export job: {e}")
        sys.exit(1)

    # Guarded on `queued` (Design L1): if the export was reaped or deleted
    # while the task spun up, claim nothing and exit cleanly. started_at
    # anchors the reaper's running-timeout (mirrors topo_jobs.started_at).
    claimed = update_status(conn, EXPORT_JOB_ID, "running",
                            expected_status="queued",
                            started_at=datetime.now(timezone.utc))
    if claimed == 0:
        log.warning(f"Export {EXPORT_JOB_ID} is no longer queued (reaped or "
                    "deleted) — exiting without rendering.")
        conn.close()
        return

    error_msg: Optional[str] = None
    result_key: Optional[str] = None
    result_bytes: Optional[int] = None
    job_name: Optional[str] = None

    try:
        source_jobs = get_source_jobs(conn, list(export_job["source_job_ids"]))
        if not source_jobs:
            raise RuntimeError("No source jobs found for this export")
        job_name = source_jobs[0].get("name")
        for sj in source_jobs:
            if sj["user_id"] != export_job["user_id"]:
                raise RuntimeError(f"Source job {sj['id']} not owned by requester")
            if sj["status"] != "complete":
                raise RuntimeError(f"Source job {sj['id']} is not complete")

        with tempfile.TemporaryDirectory(prefix="export_") as tmp:
            ctx = RenderContext(
                s3=s3,
                bucket=BUCKET,
                work_dir=Path(tmp),
                source_jobs=source_jobs,
                layers=list(export_job["layers"]),
                bundling=export_job["bundling"],
                vector_style=export_job["vector_style_snapshot"],
            )

            # Drop layers the source job never produced (e.g. OSM features when
            # Overpass returned nothing) so one empty layer can't fail the whole
            # export. Only a request with no usable layers at all is fatal.
            available = ctx.available_layers(ctx.layers)
            dropped = [l for l in ctx.layers if l not in available]
            if dropped:
                log.info(f"Dropping layers with no data for this job: {dropped}")
            if not available:
                raise RenderError("None of the selected layers have data for this job.")
            ctx.layers = available

            fmt = export_job["format"]
            log.info(
                f"Rendering format={fmt} bundling={ctx.bundling} "
                f"layers={ctx.layers} sources={[sj['id'] for sj in source_jobs]}"
            )
            if fmt == "mbtiles":
                result_local = render_mbtiles(ctx)
            elif fmt == "geotiff":
                result_local = render_geotiff(ctx)
            elif fmt == "gpkg":
                result_local = render_gpkg(ctx)
            elif fmt == "geojson":
                result_local = render_geojson(ctx)
            elif fmt == "gpx":
                result_local = render_gpx(ctx)
            else:
                raise RenderError(f"Unsupported export format: {fmt}")

            if not result_local.exists():
                raise RenderError(f"Renderer reported success but {result_local} is missing")

            result_key = f"exports/{EXPORT_JOB_ID}/{result_local.name}"
            log.info(f"Uploading result → s3://{BUCKET}/{result_key}")
            s3.upload_file(str(result_local), BUCKET, result_key)
            result_bytes = result_local.stat().st_size

    except RenderError as e:
        raw = str(e)
        log.error(f"RenderError: {raw}")          # full detail stays in worker logs
        error_msg = _scrub_paths(raw)             # path-free for DB notification + email
    except Exception as e:
        log.error(f"Unexpected failure: {e}", exc_info=True)
        # Keep raw exception out of the user-facing error message.
        error_msg = "Export failed. Contact support with export ID " + EXPORT_JOB_ID

    # Terminal write guarded on `running` (Design L1). On success the storage
    # charge shares the same commit as the status flip (ARCH-003) — never a
    # separate commit.
    if error_msg or result_key is None:
        updated = update_status(
            conn, EXPORT_JOB_ID, "failed",
            expected_status="running",
            error_message=error_msg or "Unknown failure",
            completed_at=datetime.now(timezone.utc),
        )
        ok = False
    else:
        updated = update_status(
            conn, EXPORT_JOB_ID, "completed",
            expected_status="running",
            storage_delta_bytes=result_bytes,
            result_key=result_key,
            result_bytes=result_bytes,
            completed_at=datetime.now(timezone.utc),
        )
        ok = True

    if updated == 0:
        # Export was reaped or deleted mid-render: nothing references the
        # uploaded artefact and no storage was charged — self-clean and skip
        # notification/email. Exit 0 either way (the outcome is moot).
        log.warning(f"Export {EXPORT_JOB_ID} was reaped or deleted mid-run — "
                    "cleaning up and skipping notification/email.")
        delete_s3_prefix_best_effort(f"exports/{EXPORT_JOB_ID}/")
        conn.close()
        return

    create_notification(
        conn, export_job["user_id"], "topo_export_complete",
        {
            "exportJobId": EXPORT_JOB_ID,
            "format": export_job["format"],
            "jobName": job_name,
            "status": "completed" if ok else "failed",
            "errorMessage": None if ok else (error_msg or "Unknown failure"),
        },
    )

    try:
        email = get_user_email(conn, export_job["user_id"])
        if email:
            send_completion_email(email, EXPORT_JOB_ID, export_job["format"], ok, error_msg)
    finally:
        conn.close()

    if not ok:
        sys.exit(1)


if __name__ == "__main__":
    main()
