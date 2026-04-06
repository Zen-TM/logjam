"""
worker.py
---------
ECS Fargate topo worker. Processes a single TopoJob then exits.

The job ID is read from the JOB_ID environment variable, set by the API
when it calls ecs.RunTask(). SQS is used for retry durability: if the
task crashes the message becomes visible again after the visibility
timeout and the next task will retry it.

Required environment variables:
  JOB_ID            - UUID of the TopoJob to process
  S3_BUCKET_TOPO    - S3 bucket for inputs and outputs
  DATABASE_URL      - PostgreSQL connection string

Optional environment variables:
  SQS_QUEUE_URL     - SQS queue URL (for deleting the message on success)
  SES_FROM_EMAIL    - Verified SES sender address (skips email if unset)
  AWS_REGION        - defaults to ap-southeast-2
"""

import boto3
import json
import logging
import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

import psycopg2
import psycopg2.extras
from pmtiles.convert import mbtiles_to_pmtiles

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("worker")

AWS_REGION   = os.environ.get("AWS_REGION", "ap-southeast-2")
QUEUE_URL    = os.environ.get("SQS_QUEUE_URL", "")
BUCKET       = os.environ["S3_BUCKET_TOPO"]
DATABASE_URL = os.environ["DATABASE_URL"]
SES_FROM     = os.environ.get("SES_FROM_EMAIL", "")
JOB_ID       = os.environ["JOB_ID"]

s3  = boto3.client("s3",  region_name=AWS_REGION)
sqs = boto3.client("sqs", region_name=AWS_REGION) if QUEUE_URL else None
ses = boto3.client("ses", region_name=AWS_REGION) if SES_FROM else None


# ── Database helpers ──────────────────────────────────────────────────────────

def db_connect():
    return psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)


def update_status(conn, job_id: str, status: str, **kwargs):
    """Update a job's status and optional extra columns."""
    set_clauses = ["status = %s", "updated_at = NOW()"]
    values = [status]
    for col, val in kwargs.items():
        set_clauses.append(f"{col} = %s")
        values.append(json.dumps(val) if isinstance(val, (dict, list)) else val)
    values.append(job_id)
    with conn.cursor() as cur:
        cur.execute(
            f"UPDATE topo_jobs SET {', '.join(set_clauses)} WHERE id = %s",
            values,
        )
    conn.commit()


def get_job(conn, job_id: str) -> dict:
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM topo_jobs WHERE id = %s", (job_id,))
        row = cur.fetchone()
    if not row:
        raise RuntimeError(f"Job {job_id} not found in DB")
    return dict(row)


def get_user_email(conn, user_id: str) -> str | None:
    with conn.cursor() as cur:
        cur.execute("SELECT email FROM users WHERE id = %s", (user_id,))
        row = cur.fetchone()
    return row["email"] if row else None


# ── SQS helper ────────────────────────────────────────────────────────────────

def find_and_delete_sqs_message(job_id: str):
    """Find the SQS message for this job and delete it."""
    if not sqs:
        return
    try:
        msgs = sqs.receive_message(
            QueueUrl=QUEUE_URL,
            MaxNumberOfMessages=1,
            WaitTimeSeconds=5,
        ).get("Messages", [])
        for msg in msgs:
            body = json.loads(msg["Body"])
            if body.get("jobId") == job_id:
                sqs.delete_message(QueueUrl=QUEUE_URL, ReceiptHandle=msg["ReceiptHandle"])
                return
    except Exception as e:
        log.warning(f"Failed to delete SQS message: {e}")


# ── Email ─────────────────────────────────────────────────────────────────────

def send_completion_email(to_email: str, job_id: str, output_keys: list[dict]):
    if not ses:
        return
    links = []
    for output in output_keys:
        url = s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": BUCKET, "Key": output["mbtilesKey"]},
            ExpiresIn=604800,  # 7 days
        )
        links.append(f"  {output['name']}: {url}")

    body = "\n".join([
        f"Your topo map job is complete.",
        "",
        "Download your MBTiles files (links expire in 7 days):",
        *links,
        "",
        "You can also view these layers as overlays in the Logjam app.",
    ])
    try:
        ses.send_email(
            Source=SES_FROM,
            Destination={"ToAddresses": [to_email]},
            Message={
                "Subject": {"Data": "Topo map ready — Logjam"},
                "Body":    {"Text": {"Data": body}},
            },
        )
    except Exception as e:
        log.warning(f"Failed to send completion email: {e}")


# ── Core processing ───────────────────────────────────────────────────────────

def process_job(job: dict, tmp: str) -> list[dict]:
    """
    Download ZIP, run topo pipeline, convert to PMTiles, upload all to S3.
    Returns list of { name, mbtilesKey, pmtilesKey }.
    """
    s3_input_key = job["s3_input_key"]
    job_id       = job["id"]
    layer_opts   = job.get("layer_options") or []

    # Download input ZIP from S3
    zip_path = Path(tmp) / "input.zip"
    log.info(f"Downloading {s3_input_key} …")
    s3.download_file(BUCKET, s3_input_key, str(zip_path))

    # Run topo_mbtiles.py
    output_dir = Path(tmp) / "output"
    output_dir.mkdir()
    layers_arg = ",".join(layer_opts) if layer_opts else "all"
    log.info(f"Running pipeline (layers: {layers_arg}) …")
    result = subprocess.run(
        [
            "python3",
            str(Path(__file__).parent / "topo_mbtiles.py"),
            str(zip_path),
            "--output",  str(output_dir),
            "--workers", str(os.cpu_count() or 4),
            "--layers",  layers_arg,
        ],
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"topo_mbtiles.py exited with code {result.returncode} "
            f"({'OOM kill' if result.returncode == -9 else 'non-zero exit'})"
        )

    # Upload MBTiles + convert to PMTiles and upload
    output_keys = []
    for mbtiles_path in sorted(output_dir.glob("*.mbtiles")):
        name        = mbtiles_path.stem
        mbtiles_key = f"outputs/{job_id}/{name}.mbtiles"
        pmtiles_path = output_dir / f"{name}.pmtiles"
        pmtiles_key  = f"outputs/{job_id}/{name}.pmtiles"

        log.info(f"Uploading {name}.mbtiles …")
        s3.upload_file(str(mbtiles_path), BUCKET, mbtiles_key)

        log.info(f"Converting {name} → PMTiles …")
        with sqlite3.connect(str(mbtiles_path)) as _conn:
            _row = _conn.execute("SELECT value FROM metadata WHERE name='maxzoom'").fetchone()
            maxzoom = int(_row[0]) if _row else 18
        mbtiles_to_pmtiles(str(mbtiles_path), str(pmtiles_path), maxzoom)

        log.info(f"Uploading {name}.pmtiles …")
        s3.upload_file(str(pmtiles_path), BUCKET, pmtiles_key)

        output_keys.append({
            "name":       name,
            "mbtilesKey": mbtiles_key,
            "pmtilesKey": pmtiles_key,
        })

    return output_keys


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    log.info(f"Worker started — job {JOB_ID}")

    conn = db_connect()
    job  = get_job(conn, JOB_ID)
    update_status(conn, JOB_ID, "processing")

    try:
        with tempfile.TemporaryDirectory() as tmp:
            output_keys = process_job(job, tmp)

        update_status(conn, JOB_ID, "complete", s3_output_keys=output_keys)
        log.info(f"Job {JOB_ID} complete — {len(output_keys)} layer(s) uploaded")

        email = get_user_email(conn, job["user_id"])
        if email:
            send_completion_email(email, JOB_ID, output_keys)

        find_and_delete_sqs_message(JOB_ID)

    except Exception as e:
        log.error(f"Job {JOB_ID} failed: {e}", exc_info=True)
        update_status(conn, JOB_ID, "failed", error_message=str(e))
        # Do NOT delete SQS message — allows retry after visibility timeout
        sys.exit(1)

    finally:
        conn.close()


if __name__ == "__main__":
    main()
