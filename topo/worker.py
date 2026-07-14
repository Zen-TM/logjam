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
  FRONTEND_URL      - Base URL of the Logjam web app (e.g. https://logjam.app)
                      Used to build the deep link in the completion email.
                      If unset, email is skipped with a warning.
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
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import quote

import psycopg2
import psycopg2.extras
from pmtiles.convert import mbtiles_to_pmtiles

from email_send import send_email, wants_email

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("worker")


def safe_error_message(e: Exception) -> str:
    """Map raw exceptions to user-safe text; full traceback stays in CloudWatch."""
    msg = str(e)
    if isinstance(e, subprocess.CalledProcessError):
        return f"A pipeline subprocess failed. Contact support with job ID {JOB_ID}."
    if isinstance(e, MemoryError) or "OOM" in msg or "exit code -9" in msg:
        return "Processing ran out of memory. Try a smaller LiDAR area."
    if isinstance(e, RuntimeError):
        if "tippecanoe" in msg:
            return "Failed to build vector tiles. Contact support with job ID {}.".format(JOB_ID)
        if "pipeline.py" in msg:
            return "The topo pipeline exited with an error. Contact support with job ID {}.".format(JOB_ID)
    if isinstance(e, (OSError, IOError)):
        return "Could not read input LiDAR data. Verify the ZIP contains Elvis DTM files."
    return f"Processing failed. Contact support with job ID {JOB_ID}."

def compose_database_url() -> str:
    """Compose a Postgres connection string from discrete DB_* env vars.

    Mirrored in export_worker.py — keep both copies in sync. User and
    password are URL-quoted (safe="") because RDS-generated passwords
    contain characters like "!" that aren't valid unescaped in a URL.
    Fails loud, listing missing var NAMES only (never values).
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
FRONTEND_URL = os.environ.get("FRONTEND_URL", "")
JOB_ID       = os.environ["JOB_ID"]

# Python mirror of the canonical layer list — keep in sync with
# shared/src/topoSettings.ts → TOPO_LAYERS (the TS side all derives from it;
# this is the only remaining hand-synced copy, ARCH-010). Composite is
# intentionally absent — Stage 2 builds it on demand in the export worker.
ALL_LAYERS: frozenset[str] = frozenset({
    "hillshade",
    "vegetation",
    "slope",
    "contours",
    "features",
})

RASTER_LAYERS: frozenset[str] = frozenset({"hillshade", "vegetation", "slope"})
VECTOR_LAYERS: frozenset[str] = frozenset({"contours", "features"})

# Per-layer survey-pick policy — hand-synced mirror of the `surveyPick` field on
# shared/src/topoSettings.ts → TOPO_LAYERS (ARCH-010; guarded by
# tests/test_layer_sync.py). "density" = prefer densest survey (terrain/bedrock,
# fire-irrelevant); "recency" = prefer most-recent capture (vegetation, post-fire
# state matters); "none" = not LiDAR-derived (OSM features). Consumed by
# pipeline.py select_surveys_by_layer to split overlapping surveys per footprint.
LAYER_SURVEY_PICK: dict[str, str] = {
    "hillshade": "density",
    "vegetation": "recency",
    "slope": "density",
    "contours": "density",
    "features": "none",
}

# Hardcoded fallback when User.vector_style is NULL. Must match
# VECTOR_STYLE_DEFAULTS in shared/src/topoSettings.ts. Used only as a safety
# net — the migration backfills every user row, so this should rarely fire.
VECTOR_STYLE_DEFAULTS: dict = {
    "contours": {
        "majorColour": "#503c28dc",
        "minorColour": "#785a3ca0",
        "majorWidthM": 18,
        "minorWidthM": 8,
    },
    "features": {
        "waterway":  {"enabled": True,  "colour": "#2878dcdc", "widthZ18": 3},
        "track":     {"enabled": True,  "colour": "#a0641edc", "widthZ18": 2},
        "road":      {"enabled": True,  "colour": "#505050e6", "widthZ18": 4},
        "building":  {"enabled": True,  "colour": "#a08c78c8", "widthZ18": 2},
        "power":     {"enabled": True,  "colour": "#c8a000c8", "widthZ18": 1},
        "campsite":  {"enabled": True,  "colour": "#00a050e6", "widthZ18": 14},
        "peak":      {"enabled": True,  "colour": "#503214f0", "widthZ18": 12},
        "spring":    {"enabled": True,  "colour": "#1e5ad2e6", "widthZ18": 8},
        "gate":      {"enabled": True,  "colour": "#464646dc", "widthZ18": 10},
        "cave":      {"enabled": True,  "colour": "#3c1e0ae6", "widthZ18": 10},
        "bridge":    {"enabled": False, "colour": "#403028e6", "widthZ18": 3},
        "ford":      {"enabled": False, "colour": "#1e90ffe6", "widthZ18": 8},
        "waterfall": {"enabled": False, "colour": "#1e6ad2f0", "widthZ18": 10},
        "trailhead": {"enabled": False, "colour": "#a04020e6", "widthZ18": 12},
        "viewpoint": {"enabled": False, "colour": "#806020e6", "widthZ18": 12},
        "hut":       {"enabled": False, "colour": "#503820e6", "widthZ18": 12},
    },
    "labelScale": 1,
}


def merge_settings(layer_options: Optional[dict], vector_style: Optional[dict]) -> dict:
    """
    Merge the per-job RasterTemplateSettings (layer_options) with the
    user-level VectorStyleSettings snapshot into the legacy TopoSettings
    shape that pipeline.py consumes.

    Output keys:
      hillshade, slope, vegetation       - from layer_options (or empty/missing)
      contours: zoomBands + enabled      - from layer_options.contours
                majorColour/minorColour/
                majorWidthM/minorWidthM  - from vector_style.contours
      features: enabled                  - from layer_options.features.enabled
                features                 - from vector_style.features
    """
    raster = layer_options or {}
    vec = vector_style or VECTOR_STYLE_DEFAULTS

    merged = {
        "hillshade":  raster.get("hillshade"),
        "slope":      raster.get("slope"),
        "vegetation": raster.get("vegetation"),
    }
    merged = {k: v for k, v in merged.items() if v is not None}

    raster_contours = raster.get("contours") or {}
    vec_contours = vec.get("contours") or VECTOR_STYLE_DEFAULTS["contours"]
    merged["contours"] = {**raster_contours, **vec_contours}

    raster_features = raster.get("features") or {}
    vec_features = vec.get("features") or VECTOR_STYLE_DEFAULTS["features"]
    merged["features"] = {
        "enabled": raster_features.get("enabled", True),
        "features": vec_features,
    }

    # Global label-size multiplier (default 1). Absent on styles stored before
    # the field existed, so fall back rather than assume it's present.
    merged["labelScale"] = vec.get("labelScale", VECTOR_STYLE_DEFAULTS["labelScale"])
    return merged

s3  = boto3.client("s3",  region_name=AWS_REGION)


# ── Database helpers ──────────────────────────────────────────────────────────

def db_connect():
    return psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)


def update_status(conn, job_id: str, status: str, storage_delta_bytes: int = 0,
                  expected_status: Optional[str] = None, **kwargs) -> int:
    """Update a job's status and optional extra columns. Returns rows updated.

    If storage_delta_bytes is non-zero, the owner's storage_used_bytes is
    incremented in the SAME transaction/commit as the status update. This closes
    the ARCH-009 partial-failure window: a crash between the "complete" status
    write and the storage increment could otherwise leave a completed job whose
    bytes were never quota-accounted (under-count, no reconciliation given the
    no-reaper-for-storage gap).

    With expected_status the UPDATE is guarded (`AND status = %s`), making
    status transitions write-once (Design L1): if the job was reaped or
    deleted mid-run the write matches 0 rows, the storage increment is
    SKIPPED, and the caller must skip notification/email and self-clean any
    uploaded outputs. This is what stops a reaped-but-alive worker from
    resurrecting a `failed` job to `complete` (ARCH-001) or charging storage
    for a job the user no longer has (ARCH-007).
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


def _heartbeat_loop(job_id: str, progress_path: Path, stop_event: "threading.Event",
                    interval: float = 30.0):
    """Poll the pipeline's progress file and refresh the job's render-progress
    columns while it runs, so the reaper can tell a slow-but-alive job from a
    truly stalled one.

    Runs in a daemon thread with its OWN psycopg2 connection (connections are
    not safe to share across threads). Every write is status-guarded
    (expected_status="processing"): it's a no-op self-write that touches only
    the progress columns, and matches 0 rows once the job is reaped/completed —
    so it can never resurrect a terminal job (ARCH-001). Fully best-effort: any
    DB/file error is logged and swallowed; the thread never raises into the job,
    whose success/failure stays owned by the main thread's subprocess result.
    """
    conn = None
    try:
        conn = db_connect()
    except Exception as e:
        log.warning(f"Heartbeat disabled (no DB connection): {e}")
        return
    last_done = None
    # stop_event.wait returns True when set → exit promptly on subprocess end.
    while not stop_event.wait(interval):
        try:
            if not progress_path.exists():
                continue
            payload = json.loads(progress_path.read_text())
            done = payload.get("done")
            total = payload.get("total")
            if done is None or done == last_done:
                continue
            last_done = done
            update_status(
                conn, job_id, "processing",
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


# ── Email ─────────────────────────────────────────────────────────────────────

def send_completion_email(to_email: str, job_id: str, output_keys: list[dict],
                          osm_failed: bool = False):
    if not FRONTEND_URL:
        log.warning("FRONTEND_URL not set — skipping completion email")
        return

    base = FRONTEND_URL.rstrip("/")
    # Stage 2: job-completion email links the user to the topo job so they can
    # open the Export… dialog. Downloads are now produced on demand by the
    # export worker; the job itself only provides display PMTiles + COG sources.
    open_url = f"{base}/?topoJob={job_id}"

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
        "Your topo map job is complete.",
        "",
        f"Open it in Logjam: {open_url}",
        "",
        "Use the Export… button on the job card to download MBTiles, GeoTIFF, "
        "GeoPackage, GeoJSON, or GPX outputs.",
    ]) + osm_warning_text

    html_body = "\n".join([
        "<html>",
        "  <body>",
        '    <p style="margin:0 0 16px">'
        '<span style="display:inline-block;background-color:#deb188;border-radius:8px;padding:12px 16px">'
        f'<img src="{base}/email-logo-icon.png" alt="" width="41" height="38" '
        'style="display:inline-block;vertical-align:middle;margin-right:10px" />'
        f'<img src="{base}/email-logo.png" alt="Logjam" width="160" '
        'style="display:inline-block;vertical-align:middle" /></span></p>',
        "    <p>Your topo map job is complete.</p>",
        f'    <p><a href="{open_url}">Open it in Logjam</a></p>',
        "    <p>Use the <strong>Export…</strong> button on the job card to "
        "download MBTiles, GeoTIFF, GeoPackage, GeoJSON, or GPX outputs.</p>",
        f"    {osm_warning_html}",
        "  </body>",
        "</html>",
    ])
    send_email(to_email, "Topo map ready — Logjam", text_body, html_body)


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
    """Convert OSM features GeoJSON to vector MBTiles via tippecanoe.

    Returns None when the input is missing or has zero features. tippecanoe
    fails with "Did not read any valid geometries" on empty FeatureCollections,
    which would otherwise kill the whole job (e.g. when Overpass returns 0
    matches in a remote area, or the user disables every OSM feature class).
    """
    input_path = Path(geojson_dir) / "osm_features.geojson"
    if not input_path.exists():
        log.warning("No OSM features GeoJSON found — skipping vector features.")
        return None

    try:
        with open(input_path, "r", encoding="utf-8") as f:
            feature_count = len(json.load(f).get("features", []))
    except (json.JSONDecodeError, OSError) as e:
        log.warning(f"Could not parse {input_path} ({e}) — skipping vector features.")
        return None
    if feature_count == 0:
        log.warning("OSM features GeoJSON contains 0 features — skipping vector features.")
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

def process_job(job: dict, tmp: str) -> tuple[list[dict], Path, bool, int, Optional[dict]]:
    """
    Download ZIP, run topo pipeline, convert to PMTiles, upload all to S3.
    Returns (output_keys, footprint_local, osm_failed, total_output_bytes,
    pipeline_metrics).
    osm_failed is True when the Overpass fetch did not produce a GeoJSON
    (so the features layer will be empty/missing). pipeline_metrics is the
    parsed runtime metrics dict (or None if absent/unreadable).
    """
    s3_input_key = job["s3_input_key"]
    job_id       = job["id"]

    # Download input ZIP from S3
    zip_path = Path(tmp) / "input.zip"
    log.info(f"Downloading {s3_input_key} …")
    s3.download_file(BUCKET, s3_input_key, str(zip_path))

    # Merge per-job raster template settings (TopoJob.layer_options) with the
    # vector style snapshot taken at job-submit time
    # (TopoJob.vector_style_snapshot) into the legacy TopoSettings shape that
    # pipeline.py expects. The pipeline uses the merged dict to drive both
    # raster compositing colours and OSM/contour selection.
    output_dir = Path(tmp) / "output"
    output_dir.mkdir()
    geojson_dir = Path(tmp) / "geojson_export"
    geojson_dir.mkdir()
    # Worker now always pins --work-dir so we can upload styled per-layer
    # GeoTIFFs (TopoExportDialog GeoTIFF format option).
    pipeline_work_dir = Path(tmp) / "pipeline_work"
    pipeline_work_dir.mkdir()
    cmd = [
        "python3",
        str(Path(__file__).parent / "pipeline.py"),
        str(zip_path),
        "--output",  str(output_dir),
        "--work-dir", str(pipeline_work_dir),
        "--workers", str(os.cpu_count() or 4),
        "--layers",  "all",
        "--export-geojson",   str(geojson_dir),
        "--export-footprint", str(geojson_dir),
    ]

    layer_options = job.get("layer_options")
    vector_style_snapshot = job.get("vector_style_snapshot")
    merged_settings = merge_settings(layer_options, vector_style_snapshot)
    settings_path = Path(tmp) / "settings.json"
    with open(settings_path, "w", encoding="utf-8") as f:
        json.dump(merged_settings, f)
    metrics_path = Path(tmp) / "metrics.json"
    progress_path = Path(tmp) / "progress.json"
    cmd.extend([
        "--settings-json", str(settings_path),
        "--metrics-json", str(metrics_path),
        "--progress-file", str(progress_path),
    ])
    log.info(f"Merged render settings written to {settings_path}")
    log.info("Running pipeline …")

    # Heartbeat thread refreshes the job's progress columns from progress.json
    # while the pipeline runs (see _heartbeat_loop). The main thread keeps the
    # blocking subprocess.run; the thread is signalled to stop when it returns.
    stop_heartbeat = threading.Event()
    heartbeat = threading.Thread(
        target=_heartbeat_loop,
        args=(job["id"], progress_path, stop_heartbeat),
        daemon=True,
    )
    heartbeat.start()
    try:
        result = subprocess.run(cmd)
    finally:
        stop_heartbeat.set()
        heartbeat.join(timeout=5)
    if result.returncode != 0:
        raise RuntimeError(
            f"pipeline.py exited with code {result.returncode} "
            f"({'OOM kill' if result.returncode == -9 else 'non-zero exit'})"
        )

    # Best-effort: read the pipeline's runtime metrics file. A missing/partial
    # file just means no instrumentation for this job — never fail the job.
    pipeline_metrics = None
    try:
        if metrics_path.exists():
            pipeline_metrics = json.loads(metrics_path.read_text())
    except Exception as e:
        log.warning(f"Failed to read metrics JSON (non-fatal): {e}")

    footprint_local = geojson_dir / "footprint.geojson"
    if not (geojson_dir / "osm_features.geojson").exists():
        log.warning("OSM features GeoJSON missing — Overpass fetch failed in pipeline.")

    # ── Vector tiles for contours + OSM features ────────────────────────
    # pipeline.py writes raster contours.mbtiles / features.mbtiles
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
    # True when no features layer will be produced — covers missing GeoJSON
    # (Overpass failure) and empty GeoJSON (no matches / all classes disabled).
    osm_failed = features_vector is None

    # ── Upload raw vector GeoJSONs for the export worker ────────────────
    # Stage 2: the export worker reads these directly when producing
    # GeoJSON / GPX / GPKG outputs.
    output_prefix = f"outputs/{job_id}"
    for geojson_name in ("contours_5m.geojson", "osm_features.geojson"):
        local = geojson_dir / geojson_name
        if local.exists():
            try:
                s3.upload_file(str(local), BUCKET, f"{output_prefix}/{geojson_name}")
                log.info(f"Uploaded {output_prefix}/{geojson_name}")
            except Exception as e:
                log.warning(f"Failed to upload {geojson_name}: {e}")

    # ── Optional: upload extra debug intermediates ──────────────────────
    if os.environ.get("TOPO_KEEP_INTERMEDIATES") == "1":
        debug_prefix = f"jobs/{job_id}/debug"
        debug_files = [
            "dtm_raw.tif", "dtm_filled.tif",
            "scrub_low_count_raw.tif", "scrub_high_count_raw.tif",
            "below_count_raw.tif", "all_count_raw.tif",
            "footprint.geojson",
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

    # ── Per-job upload (COG + PMTiles) ──────────────────────────────────
    # Stage 2: raster layers store a single styled COG (canonical source for
    # downstream export rendering) + PMTiles (in-app display). Vector layers
    # store PMTiles only — the raw GeoJSON uploaded above is the export
    # source. Per-layer raster MBTiles and composite.mbtiles are no longer
    # uploaded; the export worker produces those on demand.
    cog_dir = Path(tmp) / "cog"
    cog_dir.mkdir(exist_ok=True)
    output_keys = []
    total_output_bytes = 0
    skipped_vector_layers = {
        name for name in VECTOR_LAYERS if name not in vector_mbtiles_by_layer
    }
    for name in sorted(ALL_LAYERS):
        if name in skipped_vector_layers:
            log.info(f"Skipping {name} (no vector tiles produced).")
            continue
        styled_mbtiles = output_dir / f"{name}.mbtiles"
        if not styled_mbtiles.exists():
            log.info(f"Skipping {name} (renderer did not emit {styled_mbtiles.name}).")
            continue

        cog_key: Optional[str] = None
        pmtiles_key: Optional[str] = None

        # Raster layers — convert styled MBTiles → COG via GDAL's MBTiles
        # driver. The MBTiles driver mosaics the tile pyramid into a virtual
        # raster, then COG creation rolls overviews back in.
        if name in RASTER_LAYERS:
            local_cog = cog_dir / f"{name}.tif"
            log.info(f"Converting {name}.mbtiles → COG …")
            try:
                from osgeo import gdal as _gdal
                _gdal.Translate(
                    str(local_cog),
                    str(styled_mbtiles),
                    format="COG",
                    creationOptions=[
                        "COMPRESS=DEFLATE",
                        "BIGTIFF=IF_SAFER",
                        "BLOCKSIZE=512",
                        "OVERVIEWS=AUTO",
                    ],
                )
            except Exception as e:
                log.warning(f"Failed COG conversion for {name}: {e}")
                local_cog = None

            if local_cog and local_cog.exists():
                cog_key = f"{output_prefix}/{name}.tif"
                log.info(f"Uploading {cog_key} …")
                s3.upload_file(str(local_cog), BUCKET, cog_key)
                total_output_bytes += local_cog.stat().st_size

        # PMTiles for in-app display. Vector layers use the tippecanoe output;
        # raster layers reuse the styled MBTiles.
        pmtiles_source = vector_mbtiles_by_layer.get(name, styled_mbtiles)
        with sqlite3.connect(str(pmtiles_source)) as _conn:
            _row = _conn.execute("SELECT value FROM metadata WHERE name='maxzoom'").fetchone()
            maxzoom = int(_row[0]) if _row else 18
            tile_count = _conn.execute("SELECT COUNT(*) FROM tiles").fetchone()[0]

        if tile_count == 0:
            log.info(f"Skipping PMTiles for {name} (0 tiles — layer is empty)")
        else:
            pmtiles_path = output_dir / f"{name}.pmtiles"
            pmtiles_key = f"{output_prefix}/{name}.pmtiles"
            log.info(f"Converting {name} → PMTiles ({tile_count} tiles, source={pmtiles_source.name}) …")
            mbtiles_to_pmtiles(str(pmtiles_source), str(pmtiles_path), maxzoom)
            log.info(f"Uploading {pmtiles_key} …")
            s3.upload_file(str(pmtiles_path), BUCKET, pmtiles_key)
            total_output_bytes += pmtiles_path.stat().st_size

        output_keys.append({
            "name":       name,
            "cogKey":     cog_key,
            "pmtilesKey": pmtiles_key,
        })

    return output_keys, footprint_local, osm_failed, total_output_bytes, pipeline_metrics


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    log.info(f"Worker started — job {JOB_ID}")

    conn = db_connect()
    job  = get_job(conn, JOB_ID)
    # started_at anchors the reaper's "processing" staleness timeout (ARCH-002):
    # it distinguishes a long-but-alive job from a dead one. NOW() rather than a
    # column passthrough so it reflects actual worker start.
    # Guarded on `pending` (Design L1): if the job was reaped or deleted while
    # the task spun up, claim nothing and exit cleanly without processing.
    claimed = update_status(conn, JOB_ID, "processing",
                            expected_status="pending",
                            started_at=datetime.now(timezone.utc))
    if claimed == 0:
        log.warning(f"Job {JOB_ID} is no longer pending (reaped or deleted) — "
                    "exiting without processing.")
        conn.close()
        return

    try:
        with tempfile.TemporaryDirectory() as tmp:
            output_keys, footprint_local, osm_failed, total_output_bytes, pipeline_metrics = process_job(job, tmp)

            extra: dict = {"s3_output_keys": output_keys, "output_bytes": total_output_bytes}
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

        try:
            s3.delete_object(Bucket=BUCKET, Key=job["s3_input_key"])
            log.info(f"Deleted input ZIP {job['s3_input_key']}")
        except Exception as e:
            log.warning(f"Failed to delete input ZIP {job['s3_input_key']}: {e}")

        # Status flip + storage increment committed together (ARCH-009).
        # Guarded on `processing` (Design L1): if the job was reaped or
        # DELETEd mid-run, 0 rows match — the storage increment is skipped
        # inside update_status, and we self-clean the re-uploaded outputs and
        # skip notification/email instead of resurrecting a failed job.
        updated = update_status(
            conn, JOB_ID, "complete",
            expected_status="processing",
            storage_delta_bytes=total_output_bytes if total_output_bytes > 0 else 0,
            **extra,
        )
        if updated == 0:
            log.warning(f"Job {JOB_ID} was reaped or deleted mid-run — "
                        "cleaning up outputs and skipping notification/email.")
            delete_s3_prefix_best_effort(f"outputs/{JOB_ID}/")
            return

        log.info(f"Job {JOB_ID} complete — {len(output_keys)} layer(s) uploaded"
                 + (" (OSM features missing — Overpass failed)" if osm_failed else ""))

        create_notification(conn, job["user_id"], "topo_complete", {
            "jobId": JOB_ID,
            "jobName": job.get("name"),
            "footprint": extra.get("footprint"),
            "osmFailed": osm_failed,
        })

        email = get_user_email(conn, job["user_id"])
        if email and wants_email(conn, job["user_id"], "topoEmail"):
            send_completion_email(email, JOB_ID, output_keys, osm_failed=osm_failed)

    except Exception as e:
        log.error(f"Job {JOB_ID} failed: {e}", exc_info=True)
        updated = update_status(conn, JOB_ID, "failed",
                                expected_status="processing",
                                error_message=safe_error_message(e))
        if updated == 0:
            # Already reaped/deleted — outcome is moot. Clean up any partial
            # uploads and exit 0 so ECS doesn't surface a duplicate failure.
            log.warning(f"Job {JOB_ID} was reaped or deleted mid-run — "
                        "skipping failure notification.")
            delete_s3_prefix_best_effort(f"outputs/{JOB_ID}/")
            return
        create_notification(conn, job["user_id"], "topo_failed", {
            "jobId": JOB_ID,
            "jobName": job.get("name"),
        })
        sys.exit(1)

    finally:
        conn.close()


if __name__ == "__main__":
    main()
