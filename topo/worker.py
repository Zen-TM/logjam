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
import botocore.exceptions
import json
import logging
import os
import shutil
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

# Canonical list of master layer types and their tile format.
# Keep in sync with: api/src/constants/topoLayers.ts, frontend/src/topoLayerTypes.ts
MASTER_LAYERS: dict[str, str] = {
    "hillshade":  "raster",
    "vegetation": "raster",
    "slope":      "raster",
    "contours":   "vector",
    "features":   "vector",
}

MERGE_MAX_RETRIES = 3

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


# ── Vector tile generation ────────────────────────────────────────────────────

def run_tippecanoe_contours(geojson_dir: str, out_dir: str) -> Path | None:
    """Convert contour GeoJSON files to a single vector MBTiles via tippecanoe."""
    inputs = []
    for interval in [5, 10, 50]:
        path = Path(geojson_dir) / f"contours_{interval}m.geojson"
        if path.exists():
            inputs.append(str(path))
    if not inputs:
        log.warning("No contour GeoJSON files found — skipping vector contours.")
        return None

    out_path = Path(out_dir) / "contours_vector.mbtiles"
    cmd = [
        "tippecanoe",
        "-o", str(out_path),
        "-z", "18", "-Z", "12",
        "--no-feature-limit", "--no-tile-size-limit",
        "-l", "contours",
        "--force",
        *inputs,
    ]
    log.info(f"tippecanoe (contours): {len(inputs)} input file(s) …")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"tippecanoe contours failed:\n{result.stderr}")
    log.info(f"Vector contours → {out_path}")
    return out_path


def run_tippecanoe_features(geojson_dir: str, out_dir: str) -> Path | None:
    """Convert OSM features GeoJSON to vector MBTiles via tippecanoe."""
    input_path = Path(geojson_dir) / "osm_features.geojson"
    if not input_path.exists():
        log.warning("No OSM features GeoJSON found — skipping vector features.")
        return None

    out_path = Path(out_dir) / "features_vector.mbtiles"
    cmd = [
        "tippecanoe",
        "-o", str(out_path),
        "-z", "18", "-Z", "12",
        "--no-feature-limit", "--no-tile-size-limit",
        "-l", "features",
        "--force",
        str(input_path),
    ]
    log.info("tippecanoe (features) …")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"tippecanoe features failed:\n{result.stderr}")
    log.info(f"Vector features → {out_path}")
    return out_path


# ── Master PMTiles merge ─────────────────────────────────────────────────────
#
# Each master layer is a single MBTiles + PMTiles pair stored at:
#   s3://BUCKET/master/{layer}.mbtiles
#   s3://BUCKET/master/{layer}.pmtiles
#
# Merge strategy: download existing master, SQLite INSERT OR REPLACE with
# the new job's tiles, convert to PMTiles, upload both.
#
# Concurrency: uses S3 ETag optimistic locking. If another worker merges
# into the same master between our download and upload, the ETag will
# mismatch and we retry (download-merge-upload) up to MERGE_MAX_RETRIES
# times. This is safe because the current architecture typically runs one
# worker per job, but multiple jobs can run concurrently on Fargate.
# If ETag contention becomes frequent, upgrade to a DynamoDB-based lock.

def merge_into_master(layer_name: str, job_mbtiles: Path, tmp_dir: str):
    """Merge a job's MBTiles into the corresponding master file on S3."""
    master_key_mbtiles = f"master/{layer_name}.mbtiles"
    master_key_pmtiles = f"master/{layer_name}.pmtiles"

    for attempt in range(1, MERGE_MAX_RETRIES + 1):
        master_path = Path(tmp_dir) / f"master_{layer_name}_{attempt}.mbtiles"
        master_pmtiles = Path(tmp_dir) / f"master_{layer_name}_{attempt}.pmtiles"

        # Download existing master (if any) and record its ETag
        etag = None
        try:
            resp = s3.head_object(Bucket=BUCKET, Key=master_key_mbtiles)
            etag = resp["ETag"]
            log.info(f"Downloading master {layer_name}.mbtiles (ETag: {etag}) …")
            s3.download_file(BUCKET, master_key_mbtiles, str(master_path))

            size_mb = master_path.stat().st_size / (1024 * 1024)
            if size_mb > 2048:
                log.warning(
                    f"Master {layer_name}.mbtiles is {size_mb:.0f} MB. "
                    "Consider regional sharding if this continues to grow."
                )

            has_master = True
        except botocore.exceptions.ClientError as e:
            if e.response["Error"]["Code"] == "404":
                has_master = False
            else:
                raise

        if not has_master:
            log.info(f"No existing master for {layer_name} — creating from job output.")
            shutil.copy2(str(job_mbtiles), str(master_path))
        else:
            log.info(f"Merging {job_mbtiles.name} into master {layer_name} …")
            with sqlite3.connect(str(master_path)) as conn:
                conn.execute("ATTACH DATABASE ? AS job", (str(job_mbtiles),))
                conn.execute(
                    "INSERT OR REPLACE INTO tiles "
                    "SELECT zoom_level, tile_column, tile_row, tile_data "
                    "FROM job.tiles"
                )
                _update_master_bounds(conn)
                conn.commit()
                conn.execute("DETACH DATABASE job")

        # Convert to PMTiles
        with sqlite3.connect(str(master_path)) as conn:
            row = conn.execute(
                "SELECT value FROM metadata WHERE name='maxzoom'"
            ).fetchone()
            maxzoom = int(row[0]) if row else 18
        mbtiles_to_pmtiles(str(master_path), str(master_pmtiles), maxzoom)

        # Verify ETag hasn't changed (optimistic concurrency)
        if etag is not None:
            try:
                current = s3.head_object(Bucket=BUCKET, Key=master_key_mbtiles)
                current_etag = current["ETag"]
            except botocore.exceptions.ClientError:
                current_etag = None

            if current_etag != etag:
                log.warning(
                    f"Master {layer_name} ETag changed ({etag} → {current_etag}), "
                    f"retrying merge (attempt {attempt}/{MERGE_MAX_RETRIES}) …"
                )
                master_path.unlink(missing_ok=True)
                master_pmtiles.unlink(missing_ok=True)
                if attempt == MERGE_MAX_RETRIES:
                    raise RuntimeError(
                        f"Master merge for {layer_name} failed after "
                        f"{MERGE_MAX_RETRIES} ETag-conflict retries."
                    )
                continue

        log.info(f"Uploading master {layer_name}.mbtiles + .pmtiles …")
        s3.upload_file(str(master_path), BUCKET, master_key_mbtiles)
        s3.upload_file(str(master_pmtiles), BUCKET, master_key_pmtiles)
        log.info(f"Master {layer_name} updated successfully.")
        return


def _update_master_bounds(conn: sqlite3.Connection):
    """Update the bounds metadata entry to the union of master + job bounds."""
    try:
        master_bounds = conn.execute(
            "SELECT value FROM metadata WHERE name='bounds'"
        ).fetchone()
        job_bounds = conn.execute(
            "SELECT value FROM job.metadata WHERE name='bounds'"
        ).fetchone()
        if master_bounds and job_bounds:
            mb = [float(x) for x in master_bounds[0].split(",")]
            jb = [float(x) for x in job_bounds[0].split(",")]
            union = (
                f"{min(mb[0], jb[0])},{min(mb[1], jb[1])},"
                f"{max(mb[2], jb[2])},{max(mb[3], jb[3])}"
            )
            conn.execute(
                "INSERT OR REPLACE INTO metadata (name, value) VALUES ('bounds', ?)",
                (union,),
            )
    except Exception as e:
        log.warning(f"Could not update master bounds: {e}")


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

    # Run topo_mbtiles.py (produces raster MBTiles — the existing pipeline).
    # Always run with --layers all so every master layer is available for
    # the merge step, regardless of what the user selected for per-job output.
    # layerOptions only controls which files are uploaded/emailed to the user.
    output_dir = Path(tmp) / "output"
    output_dir.mkdir()
    geojson_dir = Path(tmp) / "geojson_export"
    geojson_dir.mkdir()
    log.info("Running pipeline (layers: all) …")
    result = subprocess.run(
        [
            "python3",
            str(Path(__file__).parent / "topo_mbtiles.py"),
            str(zip_path),
            "--output",  str(output_dir),
            "--workers", str(os.cpu_count() or 4),
            "--layers",  "all",
            "--export-geojson", str(geojson_dir),
        ],
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"topo_mbtiles.py exited with code {result.returncode} "
            f"({'OOM kill' if result.returncode == -9 else 'non-zero exit'})"
        )

    # ── Per-job upload (existing behaviour — raster MBTiles + PMTiles) ────
    # Only upload layers the user selected (or all if none specified).
    requested_layers = set(layer_opts) if layer_opts else None
    output_keys = []
    for mbtiles_path in sorted(output_dir.glob("*.mbtiles")):
        if requested_layers and mbtiles_path.stem not in requested_layers:
            continue
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

    # ── Master merge (new — merge each layer into communal master files) ──
    log.info("Starting master layer merge …")

    # Generate vector MBTiles for contours and features via tippecanoe
    vector_mbtiles: dict[str, Path | None] = {}
    vector_mbtiles["contours"] = run_tippecanoe_contours(str(geojson_dir), tmp)
    vector_mbtiles["features"] = run_tippecanoe_features(str(geojson_dir), tmp)

    for layer_name, fmt in MASTER_LAYERS.items():
        if fmt == "vector":
            job_mbtiles = vector_mbtiles.get(layer_name)
        else:
            job_mbtiles = output_dir / f"{layer_name}.mbtiles"

        if job_mbtiles is None or not Path(job_mbtiles).exists():
            log.info(f"Skipping master merge for {layer_name} — no output produced.")
            continue

        try:
            merge_into_master(layer_name, Path(job_mbtiles), tmp)
        except Exception as e:
            log.error(f"Master merge failed for {layer_name}: {e}")
            raise

    log.info("Master merge complete.")
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
