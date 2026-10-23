"""What CI's topo-e2e job asserts once the worker has exited. Runs inside the
worker image with the worker's env (DB_*, S3_BUCKET_TOPO, AWS_*):

  python3 check.py complete <job_id> <lon> <lat>   the job finished, in full
  python3 check.py reaped <job_id>                 a relaunch left a reaped job alone
  python3 check.py sharpened <job_id> <lon> <lat>  a job marked to sharpen made its archives

<lon> <lat> is a point inside the survey: every layer's tile there must hold
something.

Mutations that turn it red: dropping the `expected_status="pending"` guard on
worker.py's claim fails "status stays failed"; pointing FIRE_HISTORY_S3_PATH
at a missing key fails "fire history read from S3". A second worker that never
renders is caught by ci.yml's step, which needs render_tiles_done > 0 before
it kills the container. For `sharpened`: the worker running the legacy
pipeline for a marked job fails "the mark became the result"; no fill, or
fill read a tile away or flipped, fails "the fill is the statewide value, in
place".
"""

import gzip
import io
import math
import os
import sys
import tempfile

sys.path.insert(0, "/app")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ["JOB_ID"] = sys.argv[2]
from botocore.exceptions import ClientError  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402
from pmtiles.reader import MmapSource, Reader  # noqa: E402

from worker import ALL_LAYERS, BUCKET, RASTER_LAYERS, db_connect, s3  # noqa: E402
from build_nsw_dem import decode_terrarium  # noqa: E402
from statewide import FILL_BASE_M, FILL_SLOPE_DEG, X0, Y0, fill_height  # noqa: E402

failures = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what)
    if not ok:
        failures.append(what)


def tile_at(lon, lat, z):
    n = 2**z
    lat_r = math.radians(lat)
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(lat_r)) / math.pi) / 2 * n)
    return z, x, y


def exists(key):
    try:
        s3.head_object(Bucket=BUCKET, Key=key)
        return True
    except ClientError:
        return False


def query(sql, *args):
    with db_connect() as conn, conn.cursor() as cur:
        cur.execute(sql, args)
        return cur.fetchall()


def complete(job_id, lon, lat):
    job = query("SELECT * FROM topo_jobs WHERE id = %s", job_id)[0]
    check(job["status"] == "complete", f"status is complete (got {job['status']})")
    check(job["error_message"] is None, "no error message")
    check(job["footprint"] is not None, "footprint filled")
    check((job["output_bytes"] or 0) > 0, "output_bytes counted")
    check((job["output_tile_count"] or 0) > 0, "output_tile_count filled")
    metrics = job["pipeline_metrics"] or {}
    # The made-up fire raster says the whole tile burned after its 2018 capture.
    check(
        (metrics.get("fireStaleFraction") or 0) > 0.9,
        f"fire history read from S3 (fireStaleFraction {metrics.get('fireStaleFraction')})",
    )
    outputs = {o["name"]: o for o in job["s3_output_keys"] or []}
    check(set(outputs) == ALL_LAYERS, f"one output per layer (got {sorted(outputs)})")

    owner = query("SELECT storage_used_bytes FROM users WHERE id = %s", job["user_id"])
    check(
        owner[0]["storage_used_bytes"] >= job["output_bytes"], "owner's storage charged"
    )
    notes = query(
        "SELECT 1 FROM notifications WHERE type = 'topo_complete' AND payload->>'jobId' = %s",
        job_id,
    )
    check(len(notes) == 1, "one topo_complete notification")

    check(not exists(job["s3_input_key"]), "input ZIP deleted")
    for name in ("contours_5m.geojson", "osm_features.geojson"):
        check(exists(f"outputs/{job_id}/{name}"), f"{name} uploaded")

    z, x, y = tile_at(lon, lat, 15)
    for name in sorted(outputs):
        out = outputs[name]
        if name in RASTER_LAYERS:
            check(
                out.get("cogKey") and exists(out["cogKey"]),
                f"{name}: COG in the bucket",
            )
        key = out.get("pmtilesKey")
        if not (key and exists(key)):
            check(False, f"{name}: PMTiles in the bucket")
            continue
        with tempfile.TemporaryFile() as f:
            s3.download_fileobj(BUCKET, key, f)
            f.seek(0)
            tile = Reader(MmapSource(f)).get(z, x, y)
        if tile is None:
            check(False, f"{name}: tile {z}/{x}/{y} present")
            continue
        if name in RASTER_LAYERS:
            img = Image.open(io.BytesIO(tile)).convert("RGBA")
            check(
                img.getchannel("A").getbbox() is not None,
                f"{name}: tile {z}/{x}/{y} not blank",
            )
        else:
            if tile[:2] == b"\x1f\x8b":
                tile = gzip.decompress(tile)
            check(
                name.encode() in tile,
                f"{name}: tile {z}/{x}/{y} holds the {name} layer",
            )


def reaped(job_id):
    job = query("SELECT status FROM topo_jobs WHERE id = %s", job_id)[0]
    check(job["status"] == "failed", f"status stays failed (got {job['status']})")
    listed = s3.list_objects_v2(Bucket=BUCKET, Prefix=f"outputs/{job_id}/")
    check(listed.get("KeyCount", 0) == 0, "no outputs left under its prefix")
    notes = query(
        "SELECT 1 FROM notifications WHERE type = 'topo_complete' AND payload->>'jobId' = %s",
        job_id,
    )
    check(not notes, "no topo_complete notification")


def archive(key):
    f = tempfile.TemporaryFile()
    s3.download_fileobj(BUCKET, key, f)
    f.seek(0)
    return Reader(MmapSource(f))


def values(reader, z, x, y):
    tile = reader.get(z, x, y)
    if tile is None:
        return None
    return decode_terrarium(np.asarray(Image.open(io.BytesIO(tile)).convert("RGB")))


def sharpened(job_id, lon, lat):
    job = query("SELECT * FROM topo_jobs WHERE id = %s", job_id)[0]
    check(job["status"] == "complete", f"status is complete (got {job['status']})")
    result = job["sharpen"] or {}
    keys = result.get("keys") or {}
    check(
        set(keys) == {"heights", "slope", "contours"}
        and result.get("zmax") in (16, 17),
        f"the mark became the result (got {sorted(result)})",
    )
    check(job["footprint"] is not None, "footprint filled")
    check((job["output_bytes"] or 0) > 0, "output_bytes counted")
    check(job["s3_output_keys"] == [], "no legacy layers without the vegetation tick")
    check(
        result.get("ground") == "class-2",
        f"ground from the LAZ's class 2 (got {result.get('ground')})",
    )
    check(not exists(job["s3_input_key"]), "input ZIP deleted")
    if not keys:
        return
    zmax = result["zmax"]
    x0, y0, x1, y1 = result["tiles15"]
    for name in ("heights", "slope"):
        reader = archive(keys[name])
        for z in range(15, zmax + 1):
            _, x, y = tile_at(lon, lat, z)
            grid = values(reader, z, x, y)
            check(
                grid is not None and not np.isnan(grid).all(),
                f"{name}: tile {z} at the point holds values",
            )
        # Every z15 tile of the range is written, each with something.
        missing = [
            (x, y)
            for x in range(x0, x1 + 1)
            for y in range(y0, y1 + 1)
            if reader.get(15, x, y) is None
        ]
        check(
            not missing, f"{name}: every z15 tile of the range ({len(missing)} missing)"
        )
    heights = archive(keys["heights"])
    slope = archive(keys["slope"])
    _, x, y = tile_at(lon, lat, zmax)
    survey = values(heights, zmax, x, y)
    check(
        survey is not None and float(np.nanmedian(survey)) < 2000,
        "the point reads the survey's ground, not the fill",
    )
    # The made-up statewide surface is a plane far above any real ground, so
    # the range's north-west corner (outside the footprint) is fill, and each
    # of its pixels must hold the plane where it lies (statewide.py).
    f = 2 ** (zmax - 15)
    tx, ty = x0 * f, y0 * f
    corner = values(heights, zmax, tx, ty)
    misplaced, fill_pixels = 0, 0
    for row in range(256):
        for col in range(256):
            got = corner[row, col] if corner is not None else np.nan
            if not got > FILL_BASE_M - 100:
                continue
            fill_pixels += 1
            # Pixel centres at zmax, in z15 pixels from the box's corner tile.
            u = (tx * 256 + col + 0.5) / f - 0.5 - X0 * 256
            v = (ty * 256 + row + 0.5) / f - 0.5 - Y0 * 256
            misplaced += abs(got - fill_height(u, v)) > 0.1
    corner_s = values(slope, 15, x0, y0)
    check(
        fill_pixels > 1000
        and misplaced == 0
        and corner_s is not None
        and FILL_SLOPE_DEG in set(np.unique(corner_s[~np.isnan(corner_s)]).tolist()),
        f"the fill is the statewide value, in place ({fill_pixels} fill pixels,"
        f" {misplaced} misplaced)",
    )
    _, cx, cy = tile_at(lon, lat, 14)
    tile = archive(keys["contours"]).get(14, cx, cy)
    if tile and tile[:2] == b"\x1f\x8b":
        tile = gzip.decompress(tile)
    check(
        bool(tile) and b"contours" in tile, "contours: tile 14 holds the contours layer"
    )


if sys.argv[1] == "complete":
    complete(sys.argv[2], float(sys.argv[3]), float(sys.argv[4]))
elif sys.argv[1] == "sharpened":
    sharpened(sys.argv[2], float(sys.argv[3]), float(sys.argv[4]))
else:
    reaped(sys.argv[2])
sys.exit(1 if failures else 0)
