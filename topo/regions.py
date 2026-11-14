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


def region_at(lon: float, lat: float):
    """The first region whose border holds the point, or None."""
    from shapely.geometry import Point, Polygon

    point = Point(lon, lat)
    for r in REGIONS:
        if any(Polygon(ring).covers(point) for ring in r["borders"]):
            return r
    return None
