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
    DATABASE_URL        Postgres
Optional env:
    SES_FROM_EMAIL      verified SES sender (skips email if unset)
    FRONTEND_URL        for the deep-link in the email body
    AWS_REGION          default ap-southeast-2
"""

from __future__ import annotations

import json
import logging
import os
import sys
import tempfile
from pathlib import Path
from typing import Optional

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

AWS_REGION   = os.environ.get("AWS_REGION", "ap-southeast-2")
BUCKET       = os.environ["S3_BUCKET_TOPO"]
DATABASE_URL = os.environ["DATABASE_URL"]
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


def update_status(conn, export_job_id: str, status: str, **kwargs):
    set_clauses = ["status = %s"]
    values: list = [status]
    for col, val in kwargs.items():
        set_clauses.append(f"{col} = %s")
        values.append(val)
    values.append(export_job_id)
    with conn.cursor() as cur:
        cur.execute(
            f"UPDATE topo_export_jobs SET {', '.join(set_clauses)} WHERE id = %s",
            values,
        )
    conn.commit()


def get_user_email(conn, user_id: str) -> Optional[str]:
    with conn.cursor() as cur:
        cur.execute("SELECT email FROM users WHERE id = %s", (user_id,))
        row = cur.fetchone()
    return row["email"] if row else None


def increment_user_storage(conn, user_id: str, delta_bytes: int):
    """Atomically add delta_bytes to the user's storage_used_bytes."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE users SET storage_used_bytes = storage_used_bytes + %s WHERE id = %s",
            (delta_bytes, user_id),
        )
    conn.commit()


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

    update_status(conn, EXPORT_JOB_ID, "running")

    error_msg: Optional[str] = None
    result_key: Optional[str] = None
    result_bytes: Optional[int] = None

    try:
        source_jobs = get_source_jobs(conn, list(export_job["source_job_ids"]))
        if not source_jobs:
            raise RuntimeError("No source jobs found for this export")
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
        error_msg = str(e)
        log.error(f"RenderError: {error_msg}")
    except Exception as e:
        log.error(f"Unexpected failure: {e}", exc_info=True)
        # Keep raw exception out of the user-facing error message.
        error_msg = "Export failed. Contact support with export ID " + EXPORT_JOB_ID

    if error_msg or result_key is None:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE topo_export_jobs "
                "SET status = 'failed', error_message = %s, completed_at = NOW() "
                "WHERE id = %s",
                (error_msg or "Unknown failure", EXPORT_JOB_ID),
            )
        conn.commit()
        ok = False
    else:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE topo_export_jobs "
                "SET status = 'completed', result_key = %s, result_bytes = %s, "
                "    completed_at = NOW() "
                "WHERE id = %s",
                (result_key, result_bytes, EXPORT_JOB_ID),
            )
        conn.commit()
        increment_user_storage(conn, export_job["user_id"], result_bytes)
        ok = True

    create_notification(
        conn, export_job["user_id"], "topo_export_complete",
        {
            "exportJobId": EXPORT_JOB_ID,
            "format": export_job["format"],
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
