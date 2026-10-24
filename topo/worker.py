"""
worker.py
---------
ECS Fargate topo worker. Processes a single TopoJob then exits.

The job ID is read from the JOB_ID environment variable, set by the API
when it calls ecs.RunTask(). ECS RunTask owns the launch lifecycle and
the TopoJob.status column owns retry semantics.

Required environment variables:
  JOB_ID            - UUID of the TopoJob to process
  S3_BUCKET_TOPO    - S3 bucket for inputs and outputs
  DB_HOST, DB_NAME, DB_USER, DB_PASSWORD
                    - Postgres connection parts (DB_PORT optional, default 5432).
                    DB_USER/DB_PASSWORD are ECS-secrets-injected from the
                    RDS-managed Secrets Manager secret; the connection string is
                    composed at import time (see compose_database_url below).

Optional environment variables:
  RESEND_API_KEY    - Resend API key (skips email if unset; see email_send.py)
  EMAIL_FROM        - Verified sender address (skips email if unset)
  FRONTEND_URL      - Base URL of Logjam Web (e.g. https://logjam.app)
                      Used to build the deep link in the completion email.
                      If unset, email is skipped with a warning.
  AWS_REGION        - defaults to ap-southeast-2
"""

import boto3
import contextlib
import json
import logging
import os
import sqlite3
import subprocess
import sys
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import psycopg2
import psycopg2.extras
from pmtiles.convert import mbtiles_to_pmtiles

from worker_common import (
    TOO_BIG,
    compose_database_url,
    create_notification,
    get_user_email,
)
from email_send import send_email, wants_email

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("worker")


GENERIC_FAILURE = (
    "This LiDAR map couldn't be made. Make it again, and contact support if it "
    "keeps failing."
)


class JobInputError(Exception):
    """A ZIP the job cannot use; the message is the sentence its owner reads."""


# A job /start never marked to sharpen: from before new jobs sharpened their
# area, which nothing runs any more (tests/test_worker_helpers.py
# `test_an_unmarked_job_is_refused_before_its_download`).
OLD_JOB = (
    "This LiDAR map was started before LiDAR maps sharpened their area, and "
    "can't be made now. Sharpen the area again."
)


def safe_error_message(e: Exception) -> str:
    """The sentence the job's owner reads in both clients (shared/DESIGN.md §11).

    Written for them: what went wrong and what to do, with no tool's name and
    no id. Which step failed stays in CloudWatch, with the full traceback.
    """
    msg = str(e)
    if isinstance(e, JobInputError):
        return msg
    if isinstance(e, subprocess.CalledProcessError):
        return GENERIC_FAILURE
    if isinstance(e, MemoryError) or "OOM" in msg or "exit code -9" in msg:
        return TOO_BIG
    if isinstance(e, RuntimeError):
        return GENERIC_FAILURE
    if isinstance(e, (OSError, IOError)):
        return (
            "Logjam couldn't read the LiDAR data. Check the ZIP is the one ELVIS "
            "sent you."
        )
    return GENERIC_FAILURE


AWS_REGION = os.environ.get("AWS_REGION", "ap-southeast-2")
BUCKET = os.environ["S3_BUCKET_TOPO"]
DATABASE_URL = compose_database_url()
FRONTEND_URL = os.environ.get("FRONTEND_URL", "")
JOB_ID = os.environ["JOB_ID"]


s3 = boto3.client("s3", region_name=AWS_REGION)


# ── Database helpers ──────────────────────────────────────────────────────────


def db_connect():
    return psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)


def update_status(
    conn,
    job_id: str,
    status: str,
    storage_delta_bytes: int = 0,
    expected_status: Optional[str] = None,
    **kwargs,
) -> int:
    """Update a job's status and optional extra columns. Returns rows updated.

    If storage_delta_bytes is non-zero, the owner's storage_used_bytes is
    incremented in the SAME transaction/commit as the status update. This closes
    the partial-failure window: a crash between the "complete" status write and
    the storage increment could otherwise leave a completed job whose bytes
    were never quota-accounted (under-count, no reconciliation given the
    no-reaper-for-storage gap).

    With expected_status the UPDATE is guarded (`AND status = %s`), making
    status transitions write-once: if the job was reaped or deleted mid-run
    the write matches 0 rows, the storage increment is SKIPPED, and the
    caller must skip notification/email and self-clean any uploaded outputs.
    This stops a reaped-but-alive worker from resurrecting a `failed` job to
    `complete` or charging storage for a job the user no longer has.
    """
    set_clauses = ["status = %s", "updated_at = NOW()"]
    values = [status]
    for col, val in kwargs.items():
        set_clauses.append(f"{col} = %s")
        values.append(json.dumps(val) if isinstance(val, (dict, list)) else val)
    values.append(job_id)
    where = "WHERE id = %s"
    if expected_status is not None:
        where += " AND status = %s"
        values.append(expected_status)
    with conn.cursor() as cur:
        cur.execute(
            f"UPDATE topo_jobs SET {', '.join(set_clauses)} {where}",
            values,
        )
        updated = cur.rowcount
        if updated and storage_delta_bytes:
            cur.execute(
                "UPDATE users SET storage_used_bytes = storage_used_bytes + %s"
                " WHERE id = (SELECT user_id FROM topo_jobs WHERE id = %s)",
                (storage_delta_bytes, job_id),
            )
    conn.commit()
    return updated


def _heartbeat_loop(
    job_id: str,
    progress_path: Path,
    stop_event: "threading.Event",
    interval: float = 30.0,
):
    """Poll the pipeline's progress file and refresh the job's render-progress
    columns while it runs, so the reaper can tell a slow-but-alive job from a
    truly stalled one.

    Runs in a daemon thread with its OWN psycopg2 connection (connections are
    not safe to share across threads). Every write is status-guarded
    (expected_status="processing"): it's a no-op self-write that touches only
    the progress columns, and matches 0 rows once the job is reaped/completed —
    so it can never resurrect a terminal job. Fully best-effort: any
    DB/file error is logged and swallowed; the thread never raises into the job,
    whose success/failure stays owned by the main thread's subprocess result.
    """
    conn = None
    try:
        conn = db_connect()
    except Exception as e:
        log.warning(f"Heartbeat disabled (no DB connection): {e}")
        return
    last = None
    # stop_event.wait returns True when set → exit promptly on subprocess end.
    while not stop_event.wait(interval):
        try:
            if not progress_path.exists():
                continue
            payload = json.loads(progress_path.read_text())
            done = payload.get("done")
            total = payload.get("total")
            # By phase as well: sharpen.py's phases each count from 1, and a
            # phase that starts on the last one's count is still progress
            # (tests/test_heartbeat.py, "a new phase at the same count").
            if done is None or (payload.get("phase"), done) == last:
                continue
            last = (payload.get("phase"), done)
            update_status(
                conn,
                job_id,
                "processing",
                expected_status="processing",
                render_tiles_done=done,
                render_tiles_total=total,
                last_progress_at=datetime.now(timezone.utc),
            )
        except Exception as e:
            log.warning(f"Heartbeat tick failed (non-fatal): {e}")
            try:
                conn.rollback()  # psycopg2 aborts the txn on error; reset it.
            except Exception:
                conn = None
                try:
                    conn = db_connect()
                except Exception:
                    return  # give up heartbeating; the job continues unaffected
    try:
        if conn is not None:
            conn.close()
    except Exception:
        pass


def delete_s3_prefix_best_effort(prefix: str):
    """Best-effort delete of every object under prefix (reaped-job self-clean).
    Never raises — the objects are unreferenced either way and the account-
    delete prefix sweep is the backstop."""
    try:
        paginator = s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=BUCKET, Prefix=prefix):
            keys = [{"Key": obj["Key"]} for obj in page.get("Contents", [])]
            if keys:
                s3.delete_objects(Bucket=BUCKET, Delete={"Objects": keys})
        log.info(f"Cleaned up s3://{BUCKET}/{prefix}")
    except Exception as e:
        log.warning(f"Best-effort cleanup of {prefix} failed: {e}")


def delete_input_zip_best_effort(key: str):
    """Delete the uploaded ELVIS ZIP. Never raises: a leftover is a storage
    cost, not a reason to change the job's outcome."""
    try:
        s3.delete_object(Bucket=BUCKET, Key=key)
        log.info(f"Deleted input ZIP {key}")
    except Exception as e:
        log.warning(f"Failed to delete input ZIP {key}: {e}")


def get_job(conn, job_id: str) -> dict:
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM topo_jobs WHERE id = %s", (job_id,))
        row = cur.fetchone()
    if not row:
        raise RuntimeError(f"Job {job_id} not found in DB")
    return dict(row)


# ── Email ─────────────────────────────────────────────────────────────────────


def send_completion_email(to_email: str, job_id: str, output_keys: list[dict]):
    if not FRONTEND_URL:
        log.warning("FRONTEND_URL not set — skipping completion email")
        return

    base = FRONTEND_URL.rstrip("/")
    # The link opens the job in Logjam Web, whose map draws the area.
    open_url = f"{base}/?topoJob={job_id}"
    text_body = "\n".join(
        [
            "Your sharpened area is ready.",
            "",
            f"Open it in Logjam Web: {open_url}",
        ]
    )
    html_body = "\n".join(
        [
            "<html>",
            "  <body>",
            '    <p style="margin:0 0 16px">'
            f'<img src="{base}/email-logo-lockup.png" alt="Logjam" width="212" '
            'style="display:block" /></p>',
            "    <p>Your sharpened area is ready.</p>",
            f'    <p><a href="{open_url}">Open it in Logjam Web</a></p>',
            "  </body>",
            "</html>",
        ]
    )
    send_email(to_email, "Sharpened area ready — Logjam", text_body, html_body)


def send_failure_email(to_email: str, job_id: str, error_message: str):
    """Failure sibling of send_completion_email. Both are gated on the
    same `topoEmail` preference, which means "finishes or fails" — the export
    worker's send_completion_email carries ok/error in one function instead;
    this one is failure-only."""
    if not FRONTEND_URL:
        log.warning("FRONTEND_URL not set — skipping failure email")
        return

    base = FRONTEND_URL.rstrip("/")
    open_url = f"{base}/?topoJob={job_id}"

    text_body = "\n".join(
        [
            "Your topo map job failed.",
            "",
            error_message,
            "",
            f"Open it in Logjam Web: {open_url}",
        ]
    )

    html_body = "\n".join(
        [
            "<html>",
            "  <body>",
            '    <p style="margin:0 0 16px">'
            f'<img src="{base}/email-logo-lockup.png" alt="Logjam" width="212" '
            'style="display:block" /></p>',
            "    <p>Your topo map job failed.</p>",
            f"    <p><strong>{error_message}</strong></p>",
            f'    <p><a href="{open_url}">Open it in Logjam Web</a></p>',
            "  </body>",
            "</html>",
        ]
    )
    send_email(to_email, "Topo map failed — Logjam", text_body, html_body)


# ── Vector tile generation ────────────────────────────────────────────────────


# ── Future tile-serving architecture ─────────────────────────────────────────
#
# This worker currently uploads per-job MBTiles and PMTiles to
# s3://BUCKET/outputs/{job_id}/{layer}.{mbtiles,pmtiles}. The frontend reads
# each completed job's PMTiles directly and layers them on the map. There is
# no shared "master" mosaic.
#
# Planned (not implemented): a per-tile S3 mosaic at
#   s3://BUCKET/mosaic/{layer}/{z}/{x}/{y}.{png,pbf}
# with newest-write-wins semantics. Workers upload one object per tile per
# layer; boundary tiles (those not fully inside the new job's footprint) do a
# read-modify-write alpha-composite of the existing master pixels under the
# new tile. The frontend reads via CloudFront as standard MapLibre XYZ
# sources — no merge step, no exploding monolithic master file, and disjoint
# jobs trivially coexist. Anti-leech: AWS WAF per-IP rate-limit on the
# distribution + a CloudFront Function that rejects requests without an
# expected Referer header. Vector tiles (contours/features) are served the
# same way as `.pbf` with `Content-Encoding: gzip`.


# ── Core processing ───────────────────────────────────────────────────────────


def run_with_heartbeat(cmd: list[str], job_id: str, progress_path: Path) -> int:
    """Run a pipeline subprocess while a thread refreshes the job's progress
    columns from its progress file (see _heartbeat_loop). Returns the exit code."""
    stop_heartbeat = threading.Event()
    heartbeat = threading.Thread(
        target=_heartbeat_loop,
        args=(job_id, progress_path, stop_heartbeat),
        daemon=True,
    )
    heartbeat.start()
    try:
        return subprocess.run(cmd).returncode
    finally:
        stop_heartbeat.set()
        heartbeat.join(timeout=5)


def process_job(
    job: dict, tmp: str
) -> tuple[list[dict], Path, int, Optional[dict], dict]:
    """
    Download the ZIP, sharpen it, and upload what it made. Returns
    (output_keys, footprint_local, total_output_bytes, pipeline_metrics,
    sharpen): sharpen is the `topo_jobs.sharpen` result. A job with no mark
    is refused (`OLD_JOB`) before anything is downloaded.
    """
    if not job.get("sharpen"):
        raise JobInputError(OLD_JOB)
    s3_input_key = job["s3_input_key"]
    zip_path = Path(tmp) / "input.zip"
    log.info(f"Downloading {s3_input_key} …")
    s3.download_file(BUCKET, s3_input_key, str(zip_path))
    return process_sharpen(job, tmp, zip_path)


# contours.pmtiles is absent when no 10 m level crosses the area.
SHARPEN_ARCHIVES = ("heights", "slope", "contours")


def process_sharpen(
    job: dict, tmp: str, zip_path: Path
) -> tuple[list[dict], Path, int, Optional[dict], dict]:
    """A job marked to sharpen: `sharpen.py` builds the height, slope and
    contour archives, and a ticked job also gets the vegetation layer.

    The mark (`{"v": 1, "vegetation": bool}`, written by the API's /start) is
    replaced by the result: what sharpen.py reports, the archives' keys and
    the tick (tests/test_worker_helpers.py `TestProcessSharpen`).
    """
    job_id = job["id"]
    out = Path(tmp) / "sharpen"
    metrics_path = Path(tmp) / "sharpen-metrics.json"
    progress_path = Path(tmp) / "sharpen-progress.json"
    cmd = [
        "python3",
        str(Path(__file__).parent / "sharpen.py"),
        str(zip_path),
        str(out),
        "--workers",
        str(os.cpu_count() or 4),
        "--metrics-json",
        str(metrics_path),
        "--progress-file",
        str(progress_path),
    ]
    log.info("Running sharpen …")
    code = run_with_heartbeat(cmd, job_id, progress_path)
    if code == 2 and (out / "error.json").exists():
        raise JobInputError(json.loads((out / "error.json").read_text())["sentence"])
    if code != 0:
        raise RuntimeError(
            f"sharpen.py exited with code {code} "
            f"({'OOM kill' if code == -9 else 'non-zero exit'})"
        )

    result = json.loads((out / "sharpen.json").read_text())
    pipeline_metrics = None
    try:
        pipeline_metrics = {
            **json.loads(metrics_path.read_text()),
            "pipeline": "sharpen",
        }
    except Exception as e:
        log.warning(f"Failed to read metrics JSON (non-fatal): {e}")

    total_output_bytes = 0
    keys = {}
    for name in SHARPEN_ARCHIVES:
        local = out / f"{name}.pmtiles"
        if name == "contours" and not local.exists():
            continue
        keys[name] = f"outputs/{job_id}/{name}.pmtiles"
        log.info(f"Uploading {keys[name]} …")
        s3.upload_file(
            str(local),
            BUCKET,
            keys[name],
            ExtraArgs={"ContentType": "application/vnd.pmtiles"},
        )
        total_output_bytes += local.stat().st_size

    vegetation = bool(job["sharpen"].get("vegetation"))
    output_keys: list[dict] = []
    if vegetation:
        veg_dir = Path(tmp) / "vegetation"
        veg_dir.mkdir()
        output_keys, veg_bytes, veg_metrics = process_vegetation(
            job, str(veg_dir), zip_path
        )
        total_output_bytes += veg_bytes
        # Charged with the job: credits come from wallSeconds
        # (api/src/lib/computeCredits.ts), and so does the next estimate
        # (tests/test_worker_helpers.py `TestProcessSharpen`).
        # Only onto sharpen.py's own figure: without it the job falls back to
        # its elapsed time, which already holds the vegetation pass.
        veg_seconds = (veg_metrics or {}).get("wallSeconds")
        sharpen_seconds = (pipeline_metrics or {}).get("wallSeconds")
        if isinstance(veg_seconds, (int, float)) and isinstance(
            sharpen_seconds, (int, float)
        ):
            pipeline_metrics = {
                **pipeline_metrics,
                "wallSeconds": sharpen_seconds + veg_seconds,
                "vegetationWallSeconds": veg_seconds,
                "fireStaleFraction": veg_metrics.get("fireStaleFraction"),
            }

    sharpen = {**result, "keys": keys, "vegetation": vegetation}
    return (
        output_keys,
        out / "footprint.geojson",
        total_output_bytes,
        pipeline_metrics,
        sharpen,
    )


def process_vegetation(
    job: dict, tmp: str, zip_path: Path
) -> tuple[list[dict], int, Optional[dict]]:
    """A ticked job's vegetation layer: `pipeline.py` renders it from the
    ZIP's point clouds, and its PMTiles is uploaded for display. Returns
    (output_keys, output_bytes, pipeline_metrics); no layer for a ZIP with no
    point clouds. No styled COG: nothing reads one any more."""
    job_id = job["id"]
    output_dir = Path(tmp) / "output"
    output_dir.mkdir()
    work_dir = Path(tmp) / "pipeline_work"
    work_dir.mkdir()
    settings_path = Path(tmp) / "settings.json"
    vegetation = (job.get("layer_options") or {}).get("vegetation")
    settings_path.write_text(json.dumps({"vegetation": vegetation or {}}))
    metrics_path = Path(tmp) / "metrics.json"
    progress_path = Path(tmp) / "progress.json"
    cmd = [
        "python3",
        str(Path(__file__).parent / "pipeline.py"),
        str(zip_path),
        *["--output", str(output_dir), "--work-dir", str(work_dir)],
        *["--workers", str(os.cpu_count() or 4)],
        *["--settings-json", str(settings_path)],
        *["--metrics-json", str(metrics_path), "--progress-file", str(progress_path)],
    ]
    log.info("Running the vegetation pass …")
    # The heartbeat refreshes the job's progress columns from progress.json
    # while the pipeline runs (see _heartbeat_loop).
    code = run_with_heartbeat(cmd, job_id, progress_path)
    if code != 0:
        raise RuntimeError(
            f"pipeline.py exited with code {code} "
            f"({'OOM kill' if code == -9 else 'non-zero exit'})"
        )

    # Best-effort: a missing or partial metrics file only means no
    # instrumentation for this pass; it never fails the job.
    pipeline_metrics = None
    try:
        if metrics_path.exists():
            pipeline_metrics = json.loads(metrics_path.read_text())
    except Exception as e:
        log.warning(f"Failed to read metrics JSON (non-fatal): {e}")

    mbtiles = output_dir / "vegetation.mbtiles"
    if not mbtiles.exists():
        log.info("No vegetation layer (no point clouds in the ZIP).")
        return [], 0, pipeline_metrics
    # closing(): sqlite3's own context manager commits but does NOT close.
    with contextlib.closing(sqlite3.connect(str(mbtiles))) as conn:
        row = conn.execute("SELECT value FROM metadata WHERE name='maxzoom'").fetchone()
        maxzoom = int(row[0]) if row else 18
        tile_count = conn.execute("SELECT COUNT(*) FROM tiles").fetchone()[0]
    if tile_count == 0:
        log.info("Skipping the vegetation PMTiles (0 tiles: the layer is empty).")
        return [], 0, pipeline_metrics
    pmtiles = output_dir / "vegetation.pmtiles"
    key = f"outputs/{job_id}/vegetation.pmtiles"
    log.info(f"Converting vegetation → PMTiles ({tile_count} tiles) …")
    mbtiles_to_pmtiles(str(mbtiles), str(pmtiles), maxzoom)
    log.info(f"Uploading {key} …")
    s3.upload_file(str(pmtiles), BUCKET, key)
    return (
        [{"name": "vegetation", "cogKey": None, "pmtilesKey": key}],
        pmtiles.stat().st_size,
        pipeline_metrics,
    )


# ── Entry point ───────────────────────────────────────────────────────────────


def main():
    log.info(f"Worker started — job {JOB_ID}")

    conn = db_connect()
    job = get_job(conn, JOB_ID)
    # started_at anchors the reaper's "processing" staleness timeout:
    # it distinguishes a long-but-alive job from a dead one. NOW() rather than a
    # column passthrough so it reflects actual worker start.
    # Guarded on `pending`: if the job was reaped or deleted while
    # the task spun up, claim nothing and exit cleanly without processing.
    claimed = update_status(
        conn,
        JOB_ID,
        "processing",
        expected_status="pending",
        started_at=datetime.now(timezone.utc),
    )
    if claimed == 0:
        log.warning(
            f"Job {JOB_ID} is no longer pending (reaped or deleted) — "
            "exiting without processing."
        )
        conn.close()
        return

    # Set once the `complete` flip has committed. After that point the job's
    # outputs are referenced by the row and MUST NOT be self-cleaned, however
    # the post-completion notification/push/email sequence fails.
    completed = False

    try:
        with tempfile.TemporaryDirectory() as tmp:
            (
                output_keys,
                footprint_local,
                total_output_bytes,
                pipeline_metrics,
                sharpen,
            ) = process_job(job, tmp)

            extra: dict = {
                "s3_output_keys": output_keys,
                "output_bytes": total_output_bytes,
                "sharpen": sharpen,
            }
            if footprint_local and footprint_local.exists():
                with open(footprint_local) as f:
                    fp_fc = json.load(f)
                features = fp_fc.get("features", [])
                if features:
                    extra["footprint"] = features[0]["geometry"]
            # Persist runtime instrumentation (dict → JSONB by update_status).
            if pipeline_metrics:
                extra["pipeline_metrics"] = pipeline_metrics
                output_tile_count = pipeline_metrics.get("outputTileCount")
                if isinstance(output_tile_count, int):
                    extra["output_tile_count"] = output_tile_count

        delete_input_zip_best_effort(job["s3_input_key"])

        # Status flip + storage increment committed together.
        # Guarded on `processing`: if the job was reaped or
        # DELETEd mid-run, 0 rows match — the storage increment is skipped
        # inside update_status, and we self-clean the re-uploaded outputs and
        # skip notification/email instead of resurrecting a failed job.
        updated = update_status(
            conn,
            JOB_ID,
            "complete",
            expected_status="processing",
            storage_delta_bytes=total_output_bytes if total_output_bytes > 0 else 0,
            **extra,
        )
        if updated == 0:
            log.warning(
                f"Job {JOB_ID} was reaped or deleted mid-run — "
                "cleaning up outputs and skipping notification/email."
            )
            delete_s3_prefix_best_effort(f"outputs/{JOB_ID}/")
            return
        completed = True

        log.info(f"Job {JOB_ID} complete — {len(output_keys)} layer(s) uploaded")

        create_notification(
            conn,
            job["user_id"],
            "topo_complete",
            {
                "jobId": JOB_ID,
                "jobName": job.get("name"),
                "footprint": extra.get("footprint"),
            },
        )
        # Best-effort push — generic title + opaque IDs only (privacy rule:
        # job name/footprint stay in the in-app notification, never in a push).
        from push_send import send_push

        send_push(conn, job["user_id"], {"type": "topo_complete", "jobId": JOB_ID})

        email = get_user_email(conn, job["user_id"])
        if email and wants_email(conn, job["user_id"], "topoEmail"):
            send_completion_email(email, JOB_ID, output_keys)

    except Exception as e:
        if completed:
            # The job IS complete and its outputs are live — only the
            # best-effort notification/push/email tail raised.
            # Never self-clean here: the guarded `failed` write below would
            # match 0 rows (status is `complete`, not `processing`) and the
            # 0-rowcount branch would delete the finished job's outputs.
            log.error(
                f"Job {JOB_ID} completed but post-completion notification failed: {e}",
                exc_info=True,
            )
            return
        log.error(f"Job {JOB_ID} failed: {e}", exc_info=True)
        error_text = safe_error_message(e)
        # Retry is a new job with a new upload, so nothing reuses this ZIP.
        delete_input_zip_best_effort(job["s3_input_key"])
        updated = update_status(
            conn,
            JOB_ID,
            "failed",
            expected_status="processing",
            error_message=error_text,
        )
        if updated == 0:
            # Already reaped/deleted — outcome is moot. Clean up any partial
            # uploads and exit 0 so ECS doesn't surface a duplicate failure.
            log.warning(
                f"Job {JOB_ID} was reaped or deleted mid-run — "
                "skipping failure notification."
            )
            delete_s3_prefix_best_effort(f"outputs/{JOB_ID}/")
            return
        create_notification(
            conn,
            job["user_id"],
            "topo_failed",
            {
                "jobId": JOB_ID,
                "jobName": job.get("name"),
            },
        )
        # Best-effort push — generic title + opaque IDs only.
        from push_send import send_push

        send_push(conn, job["user_id"], {"type": "topo_failed", "jobId": JOB_ID})

        # Failure email, gated on the same `topoEmail` preference as
        # the completion email. Wrapped for the same reason export_worker.py
        # wraps its notification tail: the row is already `failed`, so
        # a mail problem must not change the job outcome or the exit code.
        try:
            email = get_user_email(conn, job["user_id"])
            if email and wants_email(conn, job["user_id"], "topoEmail"):
                send_failure_email(email, JOB_ID, error_text)
        except Exception as mail_error:
            log.warning(f"Job {JOB_ID}: failure email failed: {mail_error}")

        sys.exit(1)

    finally:
        conn.close()


if __name__ == "__main__":
    main()
