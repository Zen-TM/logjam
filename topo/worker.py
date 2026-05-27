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
  DATABASE_URL      - PostgreSQL connection string

Optional environment variables:
  SES_FROM_EMAIL    - Verified SES sender address (skips email if unset)
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
        if "topo_mbtiles" in msg:
            return "The topo pipeline exited with an error. Contact support with job ID {}.".format(JOB_ID)
    if isinstance(e, (OSError, IOError)):
        return "Could not read input LiDAR data. Verify the ZIP contains Elvis DTM files."
    return f"Processing failed. Contact support with job ID {JOB_ID}."

AWS_REGION   = os.environ.get("AWS_REGION", "ap-southeast-2")
BUCKET       = os.environ["S3_BUCKET_TOPO"]
DATABASE_URL = os.environ["DATABASE_URL"]
SES_FROM     = os.environ.get("SES_FROM_EMAIL", "")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "")
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
}


def merge_settings(layer_options: Optional[dict], vector_style: Optional[dict]) -> dict:
    """
    Merge the per-job RasterTemplateSettings (layer_options) with the
    user-level VectorStyleSettings snapshot into the legacy TopoSettings
    shape that topo_mbtiles.py consumes.

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
    return merged

s3  = boto3.client("s3",  region_name=AWS_REGION)
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


def increment_user_storage(conn, job_id: str, delta_bytes: int):
    """Atomically add delta_bytes to the job owner's storage_used_bytes."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE users SET storage_used_bytes = storage_used_bytes + %s"
            " WHERE id = (SELECT user_id FROM topo_jobs WHERE id = %s)",
            (delta_bytes, job_id),
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


def wants_topo_email(conn, user_id: str) -> bool:
    """Read users.ui_preferences.notifications.topoEmail; default True if absent."""
    with conn.cursor() as cur:
        cur.execute("SELECT ui_preferences FROM users WHERE id = %s", (user_id,))
        row = cur.fetchone()
    if not row:
        return False
    prefs = row["ui_preferences"] or {}
    notifications = prefs.get("notifications") if isinstance(prefs, dict) else None
    if not isinstance(notifications, dict):
        return True
    value = notifications.get("topoEmail")
    return True if not isinstance(value, bool) else value


# ── Email ─────────────────────────────────────────────────────────────────────

def send_completion_email(to_email: str, job_id: str, output_keys: list[dict],
                          osm_failed: bool = False):
    if not ses:
        return
    if not FRONTEND_URL:
        log.warning("FRONTEND_URL not set — skipping completion email")
        return

    base = FRONTEND_URL.rstrip("/")

    def _display(name: str) -> str:
        return "Composite (all layers)" if name == "composite" else name.capitalize()

    layers_text = "\n".join(
        f"  {_display(o['name'])}: {base}/?topoJob={job_id}&download={o['name']}"
        for o in output_keys
    )
    layers_html = "\n".join(
        f'    <li><a href="{base}/?topoJob={job_id}&download={o["name"]}">'
        f'{_display(o["name"])}.mbtiles</a></li>'
        for o in output_keys
    )

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
        "Click a link below to download that layer (you must be signed in to Logjam):",
        "",
        layers_text,
        "",
        "You can also view these layers as overlays in the app.",
    ]) + osm_warning_text

    html_body = "\n".join([
        "<html>",
        "  <body>",
        "    <p>Your topo map job is complete.</p>",
        "    <p>Click a link below to download that layer (you must be signed in to Logjam):</p>",
        "    <ul>",
        layers_html,
        "    </ul>",
        "    <p>You can also view these layers as overlays in the app.</p>",
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

def process_job(job: dict, tmp: str) -> tuple[list[dict], Path, bool, int]:
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

    # Merge per-job raster template settings (TopoJob.layer_options) with the
    # vector style snapshot taken at job-submit time
    # (TopoJob.vector_style_snapshot) into the legacy TopoSettings shape that
    # topo_mbtiles.py expects. The pipeline uses the merged dict to drive both
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
        str(Path(__file__).parent / "topo_mbtiles.py"),
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
    cmd.extend(["--settings-json", str(settings_path)])
    log.info(f"Merged render settings written to {settings_path}")
    log.info("Running pipeline …")
    result = subprocess.run(cmd)
    if result.returncode != 0:
        raise RuntimeError(
            f"topo_mbtiles.py exited with code {result.returncode} "
            f"({'OOM kill' if result.returncode == -9 else 'non-zero exit'})"
        )

    footprint_local = geojson_dir / "footprint.geojson"
    if not (geojson_dir / "osm_features.geojson").exists():
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
    # True when no features layer will be produced — covers missing GeoJSON
    # (Overpass failure) and empty GeoJSON (no matches / all classes disabled).
    osm_failed = features_vector is None

    # ── Upload per-layer GeoTIFFs for the Export… dialog ────────────────
    # Single-band raw intermediates from the pipeline work dir. Users with
    # GIS tooling (QGIS, ArcGIS) apply their own colormap. Vegetation is the
    # scrub-density ratio raster, only present in Modes B and C.
    geotiff_prefix = f"outputs/{job_id}"
    geotiff_uploads = [
        ("hillshade.tif",   pipeline_work_dir / "hillshade.tif"),
        ("slope.tif",       pipeline_work_dir / "slope.tif"),
        ("vegetation.tif",  pipeline_work_dir / "scrub_density.tif"),
    ]
    for s3_name, local in geotiff_uploads:
        if local.exists():
            try:
                s3.upload_file(str(local), BUCKET, f"{geotiff_prefix}/{s3_name}")
                total_geotiff_bytes = local.stat().st_size
                log.info(f"Uploaded {geotiff_prefix}/{s3_name} ({total_geotiff_bytes} bytes)")
            except Exception as e:
                log.warning(f"Failed to upload {s3_name}: {e}")
        else:
            log.info(f"GeoTIFF source {local.name} not present — skipped")

    # ── Upload raw vector GeoJSONs for the Export… dialog ───────────────
    for geojson_name in ("contours_5m.geojson", "osm_features.geojson"):
        local = geojson_dir / geojson_name
        if local.exists():
            try:
                s3.upload_file(str(local), BUCKET, f"{geotiff_prefix}/{geojson_name}")
                log.info(f"Uploaded {geotiff_prefix}/{geojson_name}")
            except Exception as e:
                log.warning(f"Failed to upload {geojson_name}: {e}")

    # ── Optional: upload extra debug intermediates ──────────────────────
    if os.environ.get("TOPO_KEEP_INTERMEDIATES") == "1":
        debug_prefix = f"jobs/{job_id}/debug"
        debug_files = [
            "dtm_raw.tif", "dtm_filled.tif",
            "scrub_count_raw.tif", "understorey_count_raw.tif",
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

    # ── Per-job upload (MBTiles + PMTiles) ──────────────────────────────
    # Every produced *.mbtiles is uploaded. Composite is MBTiles-only — it is
    # used solely for the completion email; the map renders the individual
    # layers, not the composite.
    output_keys = []
    total_output_bytes = 0
    # Vector layers whose tippecanoe step produced no MBTiles (empty input).
    # The raster MBTiles for these layers would still exist but is useless on
    # its own — the frontend reads vector PMTiles for these layers, so falling
    # back to the raster would produce a layer the frontend can't interpret.
    skipped_vector_layers = {
        name for name in ("features", "contours") if name not in vector_mbtiles_by_layer
    }
    for mbtiles_path in sorted(output_dir.glob("*.mbtiles")):
        name        = mbtiles_path.stem
        if name in skipped_vector_layers:
            log.info(f"Skipping upload of {name}.mbtiles (no vector tiles produced).")
            continue
        mbtiles_key = f"outputs/{job_id}/{name}.mbtiles"

        log.info(f"Uploading {name}.mbtiles …")
        s3.upload_file(str(mbtiles_path), BUCKET, mbtiles_key)
        total_output_bytes += mbtiles_path.stat().st_size

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
                total_output_bytes += pmtiles_path.stat().st_size
        else:
            log.info(f"Skipping PMTiles conversion for {name} (MBTiles-only layer)")

        output_keys.append({
            "name":       name,
            "mbtilesKey": mbtiles_key,
            "pmtilesKey": pmtiles_key,
        })

    return output_keys, footprint_local, osm_failed, total_output_bytes


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    log.info(f"Worker started — job {JOB_ID}")

    conn = db_connect()
    job  = get_job(conn, JOB_ID)
    update_status(conn, JOB_ID, "processing")

    try:
        with tempfile.TemporaryDirectory() as tmp:
            output_keys, footprint_local, osm_failed, total_output_bytes = process_job(job, tmp)

            extra: dict = {"s3_output_keys": output_keys, "output_bytes": total_output_bytes}
            if footprint_local and footprint_local.exists():
                with open(footprint_local) as f:
                    fp_fc = json.load(f)
                features = fp_fc.get("features", [])
                if features:
                    extra["footprint"] = features[0]["geometry"]

        try:
            s3.delete_object(Bucket=BUCKET, Key=job["s3_input_key"])
            log.info(f"Deleted input ZIP {job['s3_input_key']}")
        except Exception as e:
            log.warning(f"Failed to delete input ZIP {job['s3_input_key']}: {e}")

        update_status(conn, JOB_ID, "complete", **extra)
        if total_output_bytes > 0:
            increment_user_storage(conn, JOB_ID, total_output_bytes)
        log.info(f"Job {JOB_ID} complete — {len(output_keys)} layer(s) uploaded"
                 + (" (OSM features missing — Overpass failed)" if osm_failed else ""))

        create_notification(conn, job["user_id"], "topo_complete", {
            "jobId": JOB_ID,
            "jobName": job.get("name"),
            "footprint": extra.get("footprint"),
            "osmFailed": osm_failed,
        })

        email = get_user_email(conn, job["user_id"])
        if email and wants_topo_email(conn, job["user_id"]):
            send_completion_email(email, JOB_ID, output_keys, osm_failed=osm_failed)

    except Exception as e:
        log.error(f"Job {JOB_ID} failed: {e}", exc_info=True)
        update_status(conn, JOB_ID, "failed", error_message=safe_error_message(e))
        create_notification(conn, job["user_id"], "topo_failed", {
            "jobId": JOB_ID,
            "jobName": job.get("name"),
        })
        sys.exit(1)

    finally:
        conn.close()


if __name__ == "__main__":
    main()
