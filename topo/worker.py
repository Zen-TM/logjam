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
import io
import json
import logging
import math
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Optional

from PIL import Image
import psycopg2
import psycopg2.extras
from pmtiles.convert import mbtiles_to_pmtiles
from shapely.geometry import shape, mapping
from shapely.ops import unary_union

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
    html_links = []
    for output in output_keys:
        url = s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": BUCKET, "Key": output["mbtilesKey"]},
            ExpiresIn=604800,  # 7 days
        )
        links.append(f"  {output['name']}: {url}")
        html_links.append(f'<li><a href="{url}">{output["name"]}</a></li>')

    text_body = "\n".join([
        f"Your topo map job is complete.",
        "",
        "Download your MBTiles files (links expire in 7 days):",
        *links,
        "",
        "You can also view these layers as overlays in the Logjam app.",
    ])

    html_body = "\n".join([
        "<html>",
        "  <body>",
        "    <p>Your topo map job is complete.</p>",
        "    <p>Download your MBTiles files (links expire in 7 days):</p>",
        f"    <ul>{''.join(html_links)}</ul>",
        "    <p>You can also view these layers as overlays in the Logjam app.</p>",
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

def _normalize_mbtiles_schema(conn: sqlite3.Connection):
    """If 'tiles' is a VIEW (tippecanoe dedup schema), materialize it as a TABLE.

    Tippecanoe creates MBTiles with: tiles_data, tiles_shallow, tiles (VIEW).
    The merge code needs a real TABLE so INSERT OR REPLACE works.
    """
    row = conn.execute(
        "SELECT type FROM sqlite_master WHERE name='tiles'"
    ).fetchone()
    if row is None or row[0] == "table":
        return  # already a real table or doesn't exist

    log.info("Normalizing tippecanoe VIEW schema → TABLE for merge compatibility.")
    conn.executescript("""
        CREATE TABLE tiles_materialized (
            zoom_level  INTEGER,
            tile_column INTEGER,
            tile_row    INTEGER,
            tile_data   BLOB
        );
        INSERT INTO tiles_materialized
            SELECT zoom_level, tile_column, tile_row, tile_data FROM tiles;
        DROP VIEW tiles;
        ALTER TABLE tiles_materialized RENAME TO tiles;
        CREATE UNIQUE INDEX IF NOT EXISTS tile_index
            ON tiles (zoom_level, tile_column, tile_row);
        DROP TABLE IF EXISTS tiles_shallow;
        DROP TABLE IF EXISTS tiles_data;
    """)
    conn.commit()


def _composite_raster_tile(existing_data: bytes, new_data: bytes) -> bytes:
    """Alpha-composite two PNG tiles, drawing new on top of existing."""
    base = Image.open(io.BytesIO(existing_data)).convert("RGBA")
    overlay = Image.open(io.BytesIO(new_data)).convert("RGBA")
    composited = Image.alpha_composite(base, overlay)
    buf = io.BytesIO()
    composited.save(buf, format="PNG")
    return buf.getvalue()


def merge_into_master(layer_name: str, job_mbtiles: Path, tmp_dir: str,
                      fmt: str = "raster", footprint_path: Optional[str] = None):
    """Merge a job's MBTiles into the corresponding master file on S3.

    Raster layers: footprint-aware overwrite — fully-covered tiles are hard-replaced,
    boundary tiles are mask-erased then alpha-composited. Requires footprint_path.
    Vector layers: delegated to rebuild_vector_master (not called here directly).
    """
    if fmt == "vector":
        raise ValueError("Vector layers must use rebuild_vector_master, not merge_into_master.")

    master_key_mbtiles = f"master/{layer_name}.mbtiles"
    master_key_pmtiles = f"master/{layer_name}.pmtiles"

    footprint_geom = None
    if footprint_path and os.path.exists(footprint_path):
        footprint_geom = _load_footprint_geom(footprint_path)

    for attempt in range(1, MERGE_MAX_RETRIES + 1):
        master_path = Path(tmp_dir) / f"master_{layer_name}_{attempt}.mbtiles"
        master_pmtiles = Path(tmp_dir) / f"master_{layer_name}_{attempt}.pmtiles"

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
            with sqlite3.connect(str(master_path)) as conn:
                _normalize_mbtiles_schema(conn)
        else:
            log.info(f"Merging {job_mbtiles.name} into master {layer_name} (raster, footprint-aware) …")
            with sqlite3.connect(str(master_path)) as conn:
                _normalize_mbtiles_schema(conn)
                conn.execute("ATTACH DATABASE ? AS job", (str(job_mbtiles),))

                job_tiles = conn.execute(
                    "SELECT zoom_level, tile_column, tile_row, tile_data FROM job.tiles"
                ).fetchall()
                conn.execute("DETACH DATABASE job")

                for z, x, y, new_data in job_tiles:
                    if footprint_geom is not None:
                        _raster_merge_tile(conn, z, x, y, new_data, footprint_geom)
                    else:
                        # No footprint: fall back to hard replace
                        conn.execute(
                            "INSERT OR REPLACE INTO tiles "
                            "(zoom_level, tile_column, tile_row, tile_data) VALUES (?,?,?,?)",
                            (z, x, y, sqlite3.Binary(new_data)),
                        )

                _update_master_bounds_standalone(conn, job_mbtiles)
                conn.commit()

        with sqlite3.connect(str(master_path)) as conn:
            row = conn.execute("SELECT value FROM metadata WHERE name='maxzoom'").fetchone()
            maxzoom = int(row[0]) if row else 18
        mbtiles_to_pmtiles(str(master_path), str(master_pmtiles), maxzoom)

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
    """Update bounds from an ATTACHed 'job' database (legacy — unused post-refactor)."""
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


def _update_master_bounds_standalone(conn: sqlite3.Connection, job_mbtiles: Path):
    """Update master bounds metadata by reading job bounds from the job MBTiles file."""
    try:
        with sqlite3.connect(str(job_mbtiles)) as job_conn:
            job_bounds_row = job_conn.execute(
                "SELECT value FROM metadata WHERE name='bounds'"
            ).fetchone()
        if not job_bounds_row:
            return
        master_bounds = conn.execute(
            "SELECT value FROM metadata WHERE name='bounds'"
        ).fetchone()
        if master_bounds:
            mb = [float(v) for v in master_bounds[0].split(",")]
            jb = [float(v) for v in job_bounds_row[0].split(",")]
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


# ── Footprint / tile-bounds helpers ──────────────────────────────────────────

def _tile_bounds_wgs84(z: int, tile_col: int, tile_row_tms: int):
    """Return (lon_min, lat_min, lon_max, lat_max) for an MBTiles TMS tile."""
    n = 2 ** z
    y_xyz = n - 1 - tile_row_tms
    lon_min = tile_col / n * 360 - 180
    lon_max = (tile_col + 1) / n * 360 - 180
    lat_max = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y_xyz / n))))
    lat_min = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y_xyz + 1) / n))))
    return lon_min, lat_min, lon_max, lat_max


def _load_footprint_geom(footprint_path: str):
    """Load a footprint GeoJSON file → merged shapely geometry."""
    with open(footprint_path) as f:
        fc = json.load(f)
    return unary_union([shape(feat["geometry"]) for feat in fc["features"]])


def _raster_merge_tile(master_conn: sqlite3.Connection, z: int, x: int, y_tms: int,
                       new_data: bytes, footprint_geom):
    """Merge one raster tile into master using footprint-aware overwrite.

    Fully-covered tiles are hard-replaced. Boundary tiles have their master
    pixels inside the footprint zeroed, then the new tile is alpha-composited
    on top. Tiles outside the footprint are left untouched (shouldn't occur
    in practice since job tiles are rendered inside the footprint, but guarded).
    """
    from shapely.geometry import box as shapely_box

    lon_min, lat_min, lon_max, lat_max = _tile_bounds_wgs84(z, x, y_tms)
    tile_box = shapely_box(lon_min, lat_min, lon_max, lat_max)

    if not footprint_geom.intersects(tile_box):
        return  # Outside footprint — skip

    existing = master_conn.execute(
        "SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?",
        (z, x, y_tms),
    ).fetchone()

    if existing is None or footprint_geom.contains(tile_box):
        # No existing tile, or tile fully inside footprint → hard replace
        master_conn.execute(
            "INSERT OR REPLACE INTO tiles (zoom_level, tile_column, tile_row, tile_data) "
            "VALUES (?,?,?,?)",
            (z, x, y_tms, sqlite3.Binary(new_data)),
        )
        return

    # Boundary tile: erase master pixels inside footprint, then paste new tile
    inter = footprint_geom.intersection(tile_box)
    if inter.is_empty:
        return

    TILE_SIZE = 256
    tile_w = lon_max - lon_min
    tile_h = lat_max - lat_min

    from PIL import Image, ImageDraw
    import numpy as np

    def to_px(lon, lat):
        return ((lon - lon_min) / tile_w * TILE_SIZE,
                (lat_max - lat) / tile_h * TILE_SIZE)

    # Build a mask of pixels inside the footprint intersection
    mask_img = Image.new("L", (TILE_SIZE, TILE_SIZE), 0)
    draw = ImageDraw.Draw(mask_img)

    def rasterize_poly(poly):
        pts = [to_px(c[0], c[1]) for c in poly.exterior.coords]
        if len(pts) >= 3:
            draw.polygon(pts, fill=255)

    if inter.geom_type == "Polygon":
        rasterize_poly(inter)
    elif inter.geom_type in ("MultiPolygon", "GeometryCollection"):
        for g in inter.geoms:
            if g.geom_type == "Polygon":
                rasterize_poly(g)

    mask = np.array(mask_img)

    # Zero master alpha inside footprint
    base = Image.open(io.BytesIO(existing[0])).convert("RGBA")
    base_arr = np.array(base)
    base_arr[..., 3] = np.where(mask > 0, 0, base_arr[..., 3]).astype(np.uint8)
    erased = Image.fromarray(base_arr)

    # Alpha-composite the new tile on top
    overlay = Image.open(io.BytesIO(new_data)).convert("RGBA")
    result = Image.alpha_composite(erased, overlay)
    buf = io.BytesIO()
    result.save(buf, format="PNG")
    master_conn.execute(
        "UPDATE tiles SET tile_data=? WHERE zoom_level=? AND tile_column=? AND tile_row=?",
        (sqlite3.Binary(buf.getvalue()), z, x, y_tms),
    )


def rebuild_vector_master(layer_name: str, geojson_dir: str, tmp_dir: str):
    """Rebuild master vector MBTiles+PMTiles from per-job source GeoJSONs in S3.

    Fetches all jobs' footprints and source GeoJSONs ordered by created_at.
    Each job's features are clipped to (its footprint MINUS union of newer
    footprints) so newer jobs cleanly overwrite older ones in the overlap area.
    """
    # Query DB for all complete jobs ordered by age
    conn = db_connect()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, created_at FROM topo_jobs WHERE status='complete' ORDER BY created_at ASC"
        )
        rows = cur.fetchall()
    conn.close()

    if not rows:
        log.info(f"No complete jobs — skipping vector master rebuild for {layer_name}.")
        return

    geojson_keys_by_layer = {
        "contours": ["contours_5m.geojson", "contours_10m.geojson", "contours_50m.geojson"],
        "features": ["osm_features.geojson"],
    }
    src_filenames = geojson_keys_by_layer.get(layer_name, [])

    jobs_data = []
    for row in rows:
        job_id = row["id"]
        fp_key = f"jobs/{job_id}/footprint.geojson"
        fp_local = os.path.join(tmp_dir, f"fp_{job_id}.geojson")
        try:
            s3.download_file(BUCKET, fp_key, fp_local)
        except botocore.exceptions.ClientError:
            continue  # Job predates footprint support or has no footprint

        src_locals = []
        for fname in src_filenames:
            key = f"jobs/{job_id}/{fname}"
            local = os.path.join(tmp_dir, f"{job_id}_{fname}")
            try:
                s3.download_file(BUCKET, key, local)
                src_locals.append(local)
            except botocore.exceptions.ClientError:
                pass

        if src_locals:
            jobs_data.append({"job_id": job_id, "fp_local": fp_local, "srcs": src_locals})

    if not jobs_data:
        log.info(f"No jobs with source GeoJSONs for {layer_name} — skipping rebuild.")
        return

    all_fp_geoms = [_load_footprint_geom(j["fp_local"]) for j in jobs_data]

    clipped_files = []
    for i, job in enumerate(jobs_data):
        newer_geoms = all_fp_geoms[i + 1:]
        effective_region = (
            all_fp_geoms[i] if not newer_geoms
            else all_fp_geoms[i].difference(unary_union(newer_geoms))
        )
        if effective_region.is_empty:
            continue

        for src in job["srcs"]:
            with open(src) as f:
                gj = json.load(f)

            clipped = []
            for feat in gj.get("features", []):
                geom = shape(feat["geometry"])
                if not geom.is_valid:
                    geom = geom.buffer(0)
                if not effective_region.intersects(geom):
                    continue
                if effective_region.contains(geom):
                    clipped.append(feat)
                else:
                    inter = effective_region.intersection(geom)
                    if not inter.is_empty:
                        clipped.append({**feat, "geometry": mapping(inter)})

            if clipped:
                out = os.path.join(tmp_dir,
                                   f"rebuild_{layer_name}_{job['job_id']}_{os.path.basename(src)}")
                with open(out, "w") as f:
                    json.dump({"type": "FeatureCollection", "features": clipped}, f)
                clipped_files.append(out)

    if not clipped_files:
        log.info(f"No features after clipping for {layer_name} — skipping upload.")
        return

    layer_id = "contours" if layer_name == "contours" else "features"
    out_mbtiles = Path(tmp_dir) / f"master_{layer_name}_rebuild.mbtiles"
    cmd = [
        "tippecanoe",
        "-o", str(out_mbtiles),
        "-z", "18", "-Z", "12",
        "--no-feature-limit", "--no-tile-size-limit",
        "-l", layer_id,
        "--force",
        *clipped_files,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"tippecanoe rebuild for {layer_name} failed:\n{result.stderr}")

    out_pmtiles = Path(tmp_dir) / f"master_{layer_name}_rebuild.pmtiles"
    with sqlite3.connect(str(out_mbtiles)) as conn:
        row = conn.execute("SELECT value FROM metadata WHERE name='maxzoom'").fetchone()
        maxzoom = int(row[0]) if row else 18
    mbtiles_to_pmtiles(str(out_mbtiles), str(out_pmtiles), maxzoom)

    s3.upload_file(str(out_mbtiles), BUCKET, f"master/{layer_name}.mbtiles")
    s3.upload_file(str(out_pmtiles), BUCKET, f"master/{layer_name}.pmtiles")
    log.info(f"Master {layer_name} rebuilt from {len(jobs_data)} job(s) and uploaded.")


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

    # Run topo_mbtiles.py.
    # Always run with --layers all so every master layer is available for
    # the merge step, regardless of what the user selected for per-job output.
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

    # ── Upload per-job source GeoJSONs + footprint to S3 ────────────────
    # These are the authoritative source files used to rebuild the master
    # vector tiles on each job merge.
    job_s3_prefix = f"jobs/{job_id}"
    for fname in ["footprint.geojson", "osm_features.geojson",
                  "contours_5m.geojson", "contours_10m.geojson", "contours_50m.geojson"]:
        local = geojson_dir / fname
        if local.exists():
            s3.upload_file(str(local), BUCKET, f"{job_s3_prefix}/{fname}")
            log.info(f"Uploaded {job_s3_prefix}/{fname}")

    # ── Per-job upload (raster MBTiles + PMTiles for the user) ──────────
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

    # ── Master merge ─────────────────────────────────────────────────────
    log.info("Starting master layer merge …")

    footprint_path_str = str(footprint_local) if footprint_local.exists() else None

    # Raster layers: footprint-aware tile-level merge
    for layer_name, fmt in MASTER_LAYERS.items():
        if fmt != "raster":
            continue
        job_mbtiles = output_dir / f"{layer_name}.mbtiles"
        if not job_mbtiles.exists():
            log.info(f"Skipping master merge for {layer_name} — no output produced.")
            continue
        try:
            merge_into_master(layer_name, job_mbtiles, tmp,
                              fmt="raster", footprint_path=footprint_path_str)
        except Exception as e:
            log.error(f"Master raster merge failed for {layer_name}: {e}")
            raise

    # Vector layers: full rebuild from all per-job source GeoJSONs
    for layer_name, fmt in MASTER_LAYERS.items():
        if fmt != "vector":
            continue
        try:
            rebuild_vector_master(layer_name, str(geojson_dir), tmp)
        except Exception as e:
            log.error(f"Master vector rebuild failed for {layer_name}: {e}")
            raise

    log.info("Master merge complete.")
    return output_keys, footprint_local


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    log.info(f"Worker started — job {JOB_ID}")

    conn = db_connect()
    job  = get_job(conn, JOB_ID)
    update_status(conn, JOB_ID, "processing")

    try:
        with tempfile.TemporaryDirectory() as tmp:
            output_keys, footprint_local = process_job(job, tmp)

            extra: dict = {"s3_output_keys": output_keys}
            if footprint_local and footprint_local.exists():
                with open(footprint_local) as f:
                    fp_fc = json.load(f)
                features = fp_fc.get("features", [])
                if features:
                    extra["footprint"] = features[0]["geometry"]

        update_status(conn, JOB_ID, "complete", **extra)
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
