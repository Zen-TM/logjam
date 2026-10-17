"""What CI's topo-e2e job asserts once the worker has exited. Runs inside the
worker image with the worker's env (DB_*, S3_BUCKET_TOPO, AWS_*):

  python3 check.py complete <job_id> <lon> <lat>   the job finished, in full
  python3 check.py reaped <job_id>                 a relaunch left a reaped job alone

<lon> <lat> is a point inside the survey: every layer's tile there must hold
something.

Mutations that turn it red: dropping the `expected_status="pending"` guard on
worker.py's claim fails "status stays failed"; pointing FIRE_HISTORY_S3_PATH
at a missing key fails "fire history read from S3".
"""

import gzip
import io
import math
import os
import sys
import tempfile

sys.path.insert(0, "/app")
os.environ["JOB_ID"] = sys.argv[2]
from botocore.exceptions import ClientError  # noqa: E402
from PIL import Image  # noqa: E402
from pmtiles.reader import MmapSource, Reader  # noqa: E402

from worker import ALL_LAYERS, BUCKET, RASTER_LAYERS, db_connect, s3  # noqa: E402

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


if sys.argv[1] == "complete":
    complete(sys.argv[2], float(sys.argv[3]), float(sys.argv[4]))
else:
    reaped(sys.argv[2])
sys.exit(1 if failures else 0)
