"""The regions topo/ knows, read from regions.json.

regions.json is written from shared/src/regions.ts (`npm run topo-regions` in
shared/), so a worker never parses TypeScript. Its regions are in the order of
`REGIONS` there, which is the order `region_at` tries them. A region marked
`"sim": true` is a made-up one for the dev stack: it is ignored unless
SIM_REGIONS=1, and a prod runtime that sets SIM_REGIONS=1 stops at import, as
the API stops at start (tests/test_regions.py).
"""

import json
import os
from pathlib import Path

REGIONS_FILE = Path(__file__).with_name("regions.json")

# The database hosts and environment variables api/src/lib/runtime.ts reads,
# bar NODE_ENV (tests/test_regions.py `TestRuntimeParity` holds them equal).
LOCAL_DB_HOSTS = {"localhost", "127.0.0.1", "host.docker.internal", "postgres"}
RUNTIME_SIGNALS = (
    "AWS_EXECUTION_ENV",
    "ECS_CONTAINER_METADATA_URI_V4",
    "AWS_LAMBDA_FUNCTION_NAME",
)


def prod_runtime(env) -> bool:
    """Whether `env` looks like a prod worker: any one signal is enough.

    The signals api/src/lib/runtime.ts reads, bar NODE_ENV: no worker's task
    definition sets it, so an unset one cannot mean prod here.
    """
    return (
        env.get("LOGJAM_RUNTIME") == "prod"
        or any(env.get(name) for name in RUNTIME_SIGNALS)
        or env.get("DB_HOST", "") not in LOCAL_DB_HOSTS | {""}
    )


def sim_regions_on(env=None) -> bool:
    env = os.environ if env is None else env
    if env.get("SIM_REGIONS") != "1":
        return False
    if prod_runtime(env):
        raise RuntimeError("SIM_REGIONS=1 refused: this is a prod runtime")
    return True


def _load() -> list:
    with open(REGIONS_FILE, encoding="utf-8") as f:
        every = json.load(f)["regions"]
    on = sim_regions_on()
    return [r for r in every if on or not r.get("sim")]


REGIONS = _load()


def region(region_id: str) -> dict:
    """The region with this id; KeyError where there is none (or it is simulated and off)."""
    for r in REGIONS:
        if r["id"] == region_id:
            return r
    raise KeyError(region_id)


def region_at(lon: float, lat: float, regions=None):
    """The first of `regions` (this module's, when not given) whose border
    holds the point, or None."""
    from shapely.geometry import Point, Polygon

    point = Point(lon, lat)
    for r in REGIONS if regions is None else regions:
        if any(Polygon(ring).covers(point) for ring in r["borders"]):
            return r
    return None


def region_of_area(coverage, regions=None):
    """The region a sharpened area is filled from and credited to: the one
    holding the centre of its (west, south, east, north) box, or None.
    `regionOfArea` in shared/src/regions.ts is the same test, for a client
    crediting the area later (tests/test_regions.py `TestRegionOfArea` reads
    the cases its test reads)."""
    west, south, east, north = coverage
    return region_at((west + east) / 2, (south + north) / 2, regions)


def export_region(bbox, regions=None):
    """The region an area export reads its archives from: the one with
    heights holding the centre of the (west, south, east, north) box, else
    the first with heights touching it, or None. `areaExportRegion` in
    shared/src/areaExport.ts is the same choice, so the API's grid and the
    worker's archives come from one region (tests/test_regions.py
    `TestExportRegion` reads the cases its test reads)."""
    from shapely.geometry import Polygon
    from shapely.geometry import box as box_polygon

    west, south, east, north = bbox
    withheights = [
        r
        for r in (REGIONS if regions is None else regions)
        if r["terrain"].get("heights")
    ]
    found = region_at((west + east) / 2, (south + north) / 2, withheights)
    if found:
        return found
    cover = box_polygon(west, south, east, north)
    for r in withheights:
        if any(Polygon(ring).intersects(cover) for ring in r["borders"]):
            return r
    return None
