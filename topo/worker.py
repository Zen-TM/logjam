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
from typing import Optional

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

# Canonical list of layer types that get rendered onto the map.
# Composite is intentionally absent — it's MBTiles-only (email download).
# Keep in sync with: api/src/constants/topoLayers.ts, frontend/src/topoLayerTypes.ts
ALL_LAYERS: frozenset[str] = frozenset({
    "hillshade",
    "vegetation",
    "slope",
    "contours",
    "features",
})

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


def create_notification(conn, user_id: str, notif_type: str, payload: dict):
    import uuid as _uuid
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO notifications (id, user_id, type, payload, read, created_at) "
            "VALUES (%s, %s, %s, %s, false, NOW())",
            (str(_uuid.uuid4()), user_id, notif_type, json.dumps(payload)),
        )
    conn.commit()


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

def send_completion_email(to_email: str, job_id: str, output_keys: list[dict],
                          osm_failed: bool = False):
    if not ses:
        return
    links = []
    html_links = []
    for output in output_keys:
        url = s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": BUCKET, "Key": output["mbtilesKey"]},
            ExpiresIn=604800,  # 7 days
        )
        links.append(f"  {output['name']}: {url}")
        html_links.append(f'<li><a href="{url}">{output["name"]}</a></li>')

    osm_warning_text = (
        "\n\nNote: OSM features (tracks, waterways, peaks, etc.) are unavailable "
        "for this map — the Overpass API request failed. Other layers are complete. "
        "Retry the job to fetch features again."
    ) if osm_failed else ""
    osm_warning_html = (
        '<p style="color:#a06000"><strong>Note:</strong> OSM features '
        "(tracks, waterways, peaks, etc.) are unavailable for this map — "
        "the Overpass API request failed. Other layers are complete. "
        "Retry the job to fetch features again.</p>"
    ) if osm_failed else ""

    text_body = "\n".join([
        f"Your topo map job is complete.",
        "",
        "Download your MBTiles files (links expire in 7 days):",
        *links,
        "",
        "You can also view these layers as overlays in the Logjam app.",
    ]) + osm_warning_text

    html_body = "\n".join([
        "<html>",
        "  <body>",
        "    <p>Your topo map job is complete.</p>",
        "    <p>Download your MBTiles files (links expire in 7 days):</p>",
        f"    <ul>{''.join(html_links)}</ul>",
        "    <p>You can also view these layers as overlays in the Logjam app.</p>",
        f"    {osm_warning_html}",
        "  </body>",
        "</html>",
    ])
    try:
        ses.send_email(
            Source=SES_FROM,
            Destination={"ToAddresses": [to_email]},
            Message={
                "Subject": {"Data": "Topo map ready — Logjam"},
                "Body":    {
                    "Text": {"Data": text_body},
                    "Html": {"Data": html_body},
                },
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
# same way as `.pbf` with `Content-Encoding: gzip`. See the architecture
# discussion on 2026-05-11 for the cost analysis and tradeoffs.


# ── Core processing ───────────────────────────────────────────────────────────

def process_job(job: dict, tmp: str) -> tuple[list[dict], Path, bool]:
    """
    Download ZIP, run topo pipeline, convert to PMTiles, upload all to S3.
    Returns (output_keys, footprint_local, osm_failed).
    osm_failed is True when the Overpass fetch did not produce a GeoJSON
    (so the features layer will be empty/missing).
    """
    s3_input_key = job["s3_input_key"]
    job_id       = job["id"]

    # Download input ZIP from S3
    zip_path = Path(tmp) / "input.zip"
    log.info(f"Downloading {s3_input_key} …")
    s3.download_file(BUCKET, s3_input_key, str(zip_path))

    # Run topo_mbtiles.py with all layers — layer selection is no longer
    # a per-job choice; every completed job exposes every available layer.
    output_dir = Path(tmp) / "output"
    output_dir.mkdir()
    geojson_dir = Path(tmp) / "geojson_export"
    geojson_dir.mkdir()
    # When TOPO_KEEP_INTERMEDIATES=1, run with --work-dir so intermediate
    # rasters survive the subprocess and can be uploaded to S3 for debugging.
    keep_intermediates = os.environ.get("TOPO_KEEP_INTERMEDIATES") == "1"
    pipeline_work_dir: Optional[Path] = None
    cmd = [
        "python3",
        str(Path(__file__).parent / "topo_mbtiles.py"),
        str(zip_path),
        "--output",  str(output_dir),
        "--workers", str(os.cpu_count() or 4),
        "--layers",  "all",
        "--export-geojson",   str(geojson_dir),
        "--export-footprint", str(geojson_dir),
    ]
    if keep_intermediates:
        pipeline_work_dir = Path(tmp) / "pipeline_work"
        pipeline_work_dir.mkdir()
        cmd.extend(["--work-dir", str(pipeline_work_dir)])
        log.info(f"TOPO_KEEP_INTERMEDIATES=1 — intermediates will be kept at {pipeline_work_dir}")
    log.info("Running pipeline (layers: all) …")
    result = subprocess.run(cmd)
    if result.returncode != 0:
        raise RuntimeError(
            f"topo_mbtiles.py exited with code {result.returncode} "
            f"({'OOM kill' if result.returncode == -9 else 'non-zero exit'})"
        )

    footprint_local = geojson_dir / "footprint.geojson"
    osm_failed = not (geojson_dir / "osm_features.geojson").exists()
    if osm_failed:
        log.warning("OSM features GeoJSON missing — Overpass fetch failed in pipeline.")

    # ── Vector tiles for contours + OSM features ────────────────────────
    # topo_mbtiles.py writes raster contours.mbtiles / features.mbtiles
    # (used for the composite + Gaia downloads). The web app needs the
    # vector versions — run tippecanoe on the GeoJSON exports and put the
    # resulting MBTiles in vector_dir; the upload loop picks them up for
    # the vector layers' pmtiles conversion.
    vector_dir = Path(tmp) / "vector"
    vector_dir.mkdir()
    vector_mbtiles_by_layer: dict[str, Path] = {}
    contours_vector = run_tippecanoe_contours(str(geojson_dir), str(vector_dir))
    if contours_vector is not None:
        vector_mbtiles_by_layer["contours"] = contours_vector
    features_vector = run_tippecanoe_features(str(geojson_dir), str(vector_dir))
    if features_vector is not None:
        vector_mbtiles_by_layer["features"] = features_vector

    # ── Optional: upload intermediates for debugging ────────────────────
    if keep_intermediates and pipeline_work_dir is not None:
        debug_prefix = f"jobs/{job_id}/debug"
        debug_files = [
            "dtm_raw.tif", "dtm_filled.tif",
            "scrub_count_raw.tif", "understorey_count_raw.tif",
            "scrub_density.tif", "footprint.geojson",
            "hillshade.tif", "slope.tif",
        ]
        for fname in debug_files:
            local = pipeline_work_dir / fname
            if local.exists():
                try:
                    s3.upload_file(str(local), BUCKET, f"{debug_prefix}/{fname}")
                    log.info(f"Uploaded {debug_prefix}/{fname}")
                except Exception as e:
                    log.warning(f"Failed to upload debug artefact {fname}: {e}")
            else:
                log.info(f"Debug artefact {fname} not present — skipped")

    # ── Per-job upload (MBTiles + PMTiles) ──────────────────────────────
    # Every produced *.mbtiles is uploaded. Composite is MBTiles-only — it is
    # used solely for the completion email; the map renders the individual
    # layers, not the composite.
    output_keys = []
    for mbtiles_path in sorted(output_dir.glob("*.mbtiles")):
        name        = mbtiles_path.stem
        mbtiles_key = f"outputs/{job_id}/{name}.mbtiles"

        log.info(f"Uploading {name}.mbtiles …")
        s3.upload_file(str(mbtiles_path), BUCKET, mbtiles_key)

        pmtiles_key: Optional[str] = None
        if name in ALL_LAYERS:
            # Vector layers (contours, features) get their PMTiles from the
            # tippecanoe-produced vector MBTiles, not from the raster MBTiles
            # that backs the composite + Gaia download.
            pmtiles_source = vector_mbtiles_by_layer.get(name, mbtiles_path)
            with sqlite3.connect(str(pmtiles_source)) as _conn:
                _row = _conn.execute("SELECT value FROM metadata WHERE name='maxzoom'").fetchone()
                maxzoom = int(_row[0]) if _row else 18
                tile_count = _conn.execute("SELECT COUNT(*) FROM tiles").fetchone()[0]

            if tile_count == 0:
                # Layer is entirely transparent (e.g. vegetation on a Mode-A job).
                # mbtiles_to_pmtiles crashes on empty inputs. Leave pmtiles_key=None
                # so the frontend knows there's no PMTiles for this layer.
                log.info(f"Skipping PMTiles conversion for {name} (0 tiles — layer is empty)")
            else:
                pmtiles_path = output_dir / f"{name}.pmtiles"
                pmtiles_key  = f"outputs/{job_id}/{name}.pmtiles"
                log.info(f"Converting {name} → PMTiles ({tile_count} tiles, source={pmtiles_source.name}) …")
                mbtiles_to_pmtiles(str(pmtiles_source), str(pmtiles_path), maxzoom)
                log.info(f"Uploading {name}.pmtiles …")
                s3.upload_file(str(pmtiles_path), BUCKET, pmtiles_key)
        else:
            log.info(f"Skipping PMTiles conversion for {name} (MBTiles-only layer)")

        output_keys.append({
            "name":       name,
            "mbtilesKey": mbtiles_key,
            "pmtilesKey": pmtiles_key,
        })

    return output_keys, footprint_local, osm_failed


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    log.info(f"Worker started — job {JOB_ID}")

    conn = db_connect()
    job  = get_job(conn, JOB_ID)
    update_status(conn, JOB_ID, "processing")

    try:
        with tempfile.TemporaryDirectory() as tmp:
            output_keys, footprint_local, osm_failed = process_job(job, tmp)

            extra: dict = {"s3_output_keys": output_keys}
            if footprint_local and footprint_local.exists():
                with open(footprint_local) as f:
                    fp_fc = json.load(f)
                features = fp_fc.get("features", [])
                if features:
                    extra["footprint"] = features[0]["geometry"]

        update_status(conn, JOB_ID, "complete", **extra)
        log.info(f"Job {JOB_ID} complete — {len(output_keys)} layer(s) uploaded"
                 + (" (OSM features missing — Overpass failed)" if osm_failed else ""))

        create_notification(conn, job["user_id"], "topo_complete", {
            "jobId": JOB_ID,
            "jobName": job.get("name"),
            "footprint": extra.get("footprint"),
            "osmFailed": osm_failed,
        })

        email = get_user_email(conn, job["user_id"])
        if email:
            send_completion_email(email, JOB_ID, output_keys, osm_failed=osm_failed)

        find_and_delete_sqs_message(JOB_ID)

    except Exception as e:
        log.error(f"Job {JOB_ID} failed: {e}", exc_info=True)
        update_status(conn, JOB_ID, "failed", error_message=str(e))
        create_notification(conn, job["user_id"], "topo_failed", {
            "jobId": JOB_ID,
            "jobName": job.get("name"),
        })
        # Do NOT delete SQS message — allows retry after visibility timeout
        sys.exit(1)

    finally:
        conn.close()


if __name__ == "__main__":
    main()
