#!/usr/bin/env python3
"""
build_gauges.py
---------------
Publishes the river gauge files Logjam's map reads: the latest readings of
about 280 NSW gauges, and each gauge's daily history. Why they are public
files and where each number comes from: ADR 0044.

    python3 build_gauges.py run --bucket B   # what the 2-hourly ECS task runs
    python3 build_gauges.py registry         # regenerate gauges.json

`run` reads gauges.json (the committed list), asks WaterNSW's Water Data API
for the latest readings, and writes `latest.json` (`GaugeLatestFile` in
shared/src/gauges.ts). On the daily sweep it also extends each gauge's
`history/<id>.json` (`GaugeHistoryFile`) from the Bureau of Meteorology.

Sources and licences: readings, (c) State of New South Wales through
WaterNSW, which asks for that notice on every use; history from BoM's Water
Data Online, which lists WaterNSW as the owner under CC BY. Neither request
carries user input: a URL holds a gauge id and constants.
"""

import argparse
import gzip
import json
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional

FORMAT = 1
# GAUGE_PREFIX in shared/src/gauges.ts. Guard: tests/test_gauges.py.
S3_PREFIX = f"master/gauges/v{FORMAT}/"
ATTRIBUTION = (
    "© State of New South Wales through WaterNSW. "
    "History via the Bureau of Meteorology, © WaterNSW (CC BY)."
)
GAUGES_FILE = Path(__file__).with_name("gauges.json")

WATERNSW_URL = "https://api.waternsw.com.au/water/surface-water-data-api"
KEY_ENV = "WATERNSW_API_KEY"
KEY_HEADER = "Ocp-Apim-Subscription-Key"
LEVEL_VARIABLE = "StreamWaterLevel"  # metres
FLOW_VARIABLE = "FlowRate"  # ML/day
# Readings WaterNSW itself calls wrong: 255 Data Unavailable, which the portal
# sends as 0.000, and 59 Spike or data not replaced. Why these two: ADR 0044.
DROPPED_QUALITIES = {"59", "255"}
# The API takes up to 20 sites and 4 variables a call.
SITES_PER_CALL = 20
# The Basic tier: 29 calls per 24 h and 5 per minute.
CALLS_PER_DAY = 29
CALL_SPACING_S = 13
RUNS_PER_DAY = 12  # the schedule in infra/terraform/envs/prod/ecs.tf
MAX_HOT = 20  # one call a run
MAX_GAUGES = 279
# Guard for all four: tests/test_gauges.py ("fits the quota").

READINGS_DAYS = 7
SWEEP_AFTER = timedelta(hours=23)
# A gauge list this much smaller than the published one is a broken
# registry, not a change; every client would lose gauges.
MIN_COUNT_RATIO = 0.8
AEST = timezone(timedelta(hours=10))  # the portal's clock, no daylight saving

BOM_URL = "https://www.bom.gov.au/waterdata/services"
BOM_SERIES = "DMQaQc.Merged.DailyMean.24HR"
BOM_SPACING_S = 1
BOM_TIMEOUT_S = 180  # getStationList is slow; 40 s timed out for most basins
BOM_TRIES = 4
BOM_FROM = "1900-01-01"
BOM_RECENT_DAYS = 14
M3S_TO_MLD = 86.4

# Sites hot by choice: the canyoning rivers the 2026-10-30 survey found live.
# `registry` fails if one is missing from the list.
HOT = {
    "212290": "Colo at Upper Colo",
    "212291": "Grose at Burralow",
    "212260": "Kowmung at Cedar Ford",
    "212016": "Kedumba at Crossing",
    "212280": "Nattai at Smallwoods",
    "212018": "Capertee at Glen Davis",
    "215220": "Kangaroo at Hampden Bridge",
}
# Coastal basins first, then the inland NSW basins, until MAX_GAUGES.
BASINS = [str(n) for n in range(201, 223)] + [str(n) for n in range(410, 423)]
# Water NSW's owner string in BoM's custom attributes.
OWNER = "Water NSW"
NSW_BOX = (-38.0, -27.0, 140.0, 154.0)  # BoM has stations with wrong coordinates


def http_get(url: str, headers: Optional[dict] = None, timeout: int = 60):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def aest_epoch(stamp: str) -> int:
    """`01-Jan-2020 09:00` on the portal's AEST clock, as epoch seconds."""
    parsed = datetime.strptime(stamp, "%d-%b-%Y %H:%M")
    return int(parsed.replace(tzinfo=AEST).timestamp())


def load_gauges() -> List[dict]:
    return json.loads(GAUGES_FILE.read_text())


# ── latest readings ──────────────────────────────────────────────────────


def calls_per_day(hot: int, total: int) -> int:
    """WaterNSW calls in a day: every run fetches the hot gauges, and one
    run a day sweeps the rest."""
    chunks = lambda n: math.ceil(n / SITES_PER_CALL)  # noqa: E731
    return RUNS_PER_DAY * chunks(hot) + chunks(total - hot)


def parse_records(records: List[dict]) -> Dict[str, Dict[int, list]]:
    """{siteId: {epoch: [level, flow]}} from a Latest response's records.

    A reading with no value or a DROPPED_QUALITIES code is left out, so the
    gauge keeps its last good reading and shows that reading's age. A level
    and a flow at one time share one reading."""
    out: Dict[str, Dict[int, list]] = {}
    for rec in records:
        slot = {LEVEL_VARIABLE: 1, FLOW_VARIABLE: 2}.get(rec.get("variableName"))
        if slot is None or rec.get("value") is None:
            continue
        if str(rec.get("qualityCode")) in DROPPED_QUALITIES:
            continue
        row = out.setdefault(str(rec["siteId"]), {}).setdefault(
            aest_epoch(rec["timeStamp"]), [None, None]
        )
        row[slot - 1] = rec["value"]
    return out


def fetch_latest(ids: List[str], key: str) -> Dict[str, Dict[int, list]]:
    """Every page of Latest for up to SITES_PER_CALL sites."""
    out: Dict[str, Dict[int, list]] = {}
    page = 1
    while True:
        query = urllib.parse.urlencode(
            {
                "siteId": ",".join(ids),
                "frequency": "Latest",
                "variable": f"{LEVEL_VARIABLE},{FLOW_VARIABLE}",
                "pageNumber": page,
            },
            safe=",",
        )
        data = http_get(f"{WATERNSW_URL}?{query}", {KEY_HEADER: key})
        for site, times in parse_records(data.get("latestRecords") or []).items():
            out.setdefault(site, {}).update(times)
        if page >= int(data.get("totalPages") or 1):
            print(f"waternsw: {page} page(s) for {len(ids)} sites")
            return out
        page += 1
        time.sleep(CALL_SPACING_S)


def merge_readings(old: list, fresh: Dict[int, list], now: int) -> list:
    """Old `[epoch, level, flow]` rows plus fresh ones: one row per time, a
    fresh value replacing an old one, nothing past READINGS_DAYS kept."""
    rows = {r[0]: [r[1], r[2]] for r in old}
    for at, (level, flow) in fresh.items():
        row = rows.setdefault(at, [None, None])
        row[0] = level if level is not None else row[0]
        row[1] = flow if flow is not None else row[1]
    floor = now - READINGS_DAYS * 86400
    return [[at, *rows[at]] for at in sorted(rows) if at >= floor]


def build_latest(
    gauges: List[dict],
    old: Optional[dict],
    fresh: Dict[str, Dict[int, list]],
    now: datetime,
    swept: bool,
) -> dict:
    """`latest.json`: every listed gauge, with its merged readings."""
    before = {g["id"]: g["readings"] for g in (old or {}).get("gauges", [])}
    iso = lambda t: t.strftime("%Y-%m-%dT%H:%M:%SZ")  # noqa: E731
    # A first run that swept nothing stamps the epoch, so the next run sweeps.
    swept_at = (
        iso(now) if swept else old["coldSweptAt"] if old else "1970-01-01T00:00:00Z"
    )
    return {
        "version": FORMAT,
        "generatedAt": iso(now),
        "coldSweptAt": swept_at,
        "attribution": ATTRIBUTION,
        "gauges": [
            {
                "id": g["id"],
                "name": g["name"],
                "lat": g["lat"],
                "lon": g["lon"],
                "hot": g["hot"],
                "hasFlow": g["hasFlow"],
                "readings": merge_readings(
                    before.get(g["id"], []),
                    fresh.get(g["id"], {}),
                    int(now.timestamp()),
                ),
            }
            for g in gauges
        ],
    }


def needs_sweep(old: Optional[dict], now: datetime) -> bool:
    if old is None:
        return True
    swept = datetime.fromisoformat(old["coldSweptAt"].replace("Z", "+00:00"))
    return now - swept > SWEEP_AFTER


# ── history ──────────────────────────────────────────────────────────────


def bom_values_url(ts_ids: List[str], start: str, end: str) -> str:
    return (
        BOM_URL
        + "?"
        + urllib.parse.urlencode(
            {
                "service": "kisters",
                "type": "QueryServices",
                "format": "json",
                "datasource": "0",
                "request": "getTimeseriesValues",
                "ts_id": ",".join(ts_ids),
                "from": start,
                "to": end,
                "returnfields": "Timestamp,Value",
            },
            safe=",",
        )
    )


def fetch_daily(gauge: dict, start: str, end: str) -> Dict[str, list]:
    """{`YYYY-MM-DD`: [level m, flow ML/d]} from BoM's daily means."""
    ids = [t for t in (gauge["bomLevelTs"], gauge["bomFlowTs"]) if t]
    days: Dict[str, list] = {}
    for series in http_get(bom_values_url(ids, start, end), timeout=BOM_TIMEOUT_S):
        slot = 0 if str(series["ts_id"]) == gauge["bomLevelTs"] else 1
        for stamp, value in series["data"]:
            if value is None:
                continue
            row = days.setdefault(stamp[:10], [None, None])
            row[slot] = round(value, 3) if slot == 0 else round(value * M3S_TO_MLD, 2)
    return days


def history_doc(gauge_id: str, days: Dict[str, list]) -> dict:
    """`history/<id>.json`: one slot per day from the first to the last."""
    first = datetime.fromisoformat(min(days))
    n = (datetime.fromisoformat(max(days)) - first).days + 1
    slots = [
        days.get((first + timedelta(d)).strftime("%Y-%m-%d"), [None, None])
        for d in range(n)
    ]
    return {
        "version": FORMAT,
        "id": gauge_id,
        "start": first.strftime("%Y-%m-%d"),
        "level": [s[0] for s in slots],
        "flow": [s[1] for s in slots],
    }


def history_days(doc: dict) -> Dict[str, list]:
    first = datetime.fromisoformat(doc["start"])
    return {
        (first + timedelta(i)).strftime("%Y-%m-%d"): [lv, fl]
        for i, (lv, fl) in enumerate(zip(doc["level"], doc["flow"]))
    }


# ── S3 ───────────────────────────────────────────────────────────────────


def encode(doc: dict) -> bytes:
    raw = json.dumps(doc, separators=(",", ":")).encode()
    return gzip.compress(raw, compresslevel=9, mtime=0)


def read_json(s3, bucket: str, key: str) -> Optional[dict]:
    """The object, or None when absent. Listed first: S3 answers a GetObject
    for a missing key with AccessDenied unless the caller may list the whole
    bucket, and the task role may list only master/gauges/."""
    listed = s3.list_objects_v2(Bucket=bucket, Prefix=key, MaxKeys=1)
    if listed.get("KeyCount", 0) == 0:
        return None
    return json.loads(
        gzip.decompress(s3.get_object(Bucket=bucket, Key=key)["Body"].read())
    )


def put_json(s3, bucket: str, key: str, doc: dict, max_age: int) -> None:
    # Content-Encoding lets browsers and OkHttp gunzip it natively.
    s3.put_object(
        Bucket=bucket,
        Key=S3_PREFIX + key,
        Body=encode(doc),
        ContentType="application/json",
        ContentEncoding="gzip",
        CacheControl=f"public, max-age={max_age}",
    )


def history_ids(s3, bucket: str) -> set:
    """Gauges that already have a history file."""
    ids = set()
    for page in s3.get_paginator("list_objects_v2").paginate(
        Bucket=bucket, Prefix=S3_PREFIX + "history/"
    ):
        for obj in page.get("Contents", []):
            ids.add(obj["Key"].rsplit("/", 1)[1].removesuffix(".json"))
    return ids


def sweep_history(s3, bucket: str, gauges: List[dict], today: datetime) -> None:
    """A gauge without a history file gets its full series, the rest their
    last BOM_RECENT_DAYS merged in. One gauge failing is left for tomorrow."""
    have = history_ids(s3, bucket)
    end = today.strftime("%Y-%m-%d")
    recent = (today - timedelta(BOM_RECENT_DAYS)).strftime("%Y-%m-%d")
    for g in gauges:
        time.sleep(BOM_SPACING_S)
        try:
            if g["id"] in have:
                key = f"history/{g['id']}.json"
                days = history_days(read_json(s3, bucket, S3_PREFIX + key))
                for day, new in fetch_daily(g, recent, end).items():
                    # Per slot: BoM may have one variable for a recent day.
                    old = days.get(day, [None, None])
                    days[day] = [n if n is not None else o for n, o in zip(new, old)]
            else:
                days = fetch_daily(g, BOM_FROM, end)
            if days:
                put_json(
                    s3,
                    bucket,
                    f"history/{g['id']}.json",
                    history_doc(g["id"], days),
                    3600,
                )
        except Exception as err:  # noqa: BLE001
            print(f"history for {g['id']} left for tomorrow: {err}")


# ── run ──────────────────────────────────────────────────────────────────


def run(bucket: str) -> None:
    import boto3

    key = os.environ.get(KEY_ENV)
    if not key:
        raise SystemExit(f"{KEY_ENV} is not set")
    gauges = load_gauges()
    s3 = boto3.client("s3")
    old = read_json(s3, bucket, S3_PREFIX + "latest.json")
    if old is not None and len(gauges) < len(old["gauges"]) * MIN_COUNT_RATIO:
        raise SystemExit(
            f"refusing to publish {len(gauges)} gauges over {len(old['gauges'])}: "
            "check gauges.json"
        )
    now = datetime.now(timezone.utc)
    sweep = needs_sweep(old, now)
    hot = [g["id"] for g in gauges if g["hot"]]
    # A failed hot fetch exits non-zero with the old file in place; clients
    # show its age and the failed-run alarm fires.
    fresh = fetch_latest(hot, key)
    if not fresh:
        raise SystemExit("WaterNSW returned no usable hot readings")
    chunks_done, cold_failed = 0, False
    if sweep:
        rest = [g["id"] for g in gauges if not g["hot"]]
        for i in range(0, len(rest), SITES_PER_CALL):
            time.sleep(CALL_SPACING_S)
            try:
                for site, times in fetch_latest(
                    rest[i : i + SITES_PER_CALL], key
                ).items():
                    fresh.setdefault(site, {}).update(times)
                chunks_done += 1
            except Exception as err:  # noqa: BLE001
                # Stop: more calls would spend the day's quota, and the hot
                # gauges' runs with it.
                print(f"cold chunk {i // SITES_PER_CALL} failed, sweep stopped: {err}")
                cold_failed = True
                break
    # A sweep that got no chunk through is not stamped, so the next run tries
    # again; one that got some through waits for tomorrow for the rest.
    swept = sweep and (chunks_done > 0 or not cold_failed)
    put_json(
        s3, bucket, "latest.json", build_latest(gauges, old, fresh, now, swept), 300
    )
    print(f"published latest.json: {len(gauges)} gauges, sweep={sweep}")
    if swept:
        sweep_history(s3, bucket, gauges, now.astimezone(AEST))
    if cold_failed:
        # After publishing, so the failed-run alarm fires with the hot
        # readings already out.
        raise SystemExit("the cold sweep failed part way")


# ── registry ─────────────────────────────────────────────────────────────


def bom_list(**params) -> list:
    url = (
        BOM_URL
        + "?"
        + urllib.parse.urlencode(
            {
                "service": "kisters",
                "type": "QueryServices",
                "format": "json",
                "datasource": "0",
                **params,
            },
            safe=",*",
        )
    )
    # `registry` is a run-once tool, so it retries; a list it cannot finish
    # fails the command rather than writing a short one.
    for attempt in range(BOM_TRIES):
        time.sleep(BOM_SPACING_S * (attempt + 1))
        try:
            rows = http_get(url, timeout=BOM_TIMEOUT_S)
            break
        except (OSError, ValueError) as err:
            print(f"BoM try {attempt + 1} failed: {err}", flush=True)
    else:
        raise SystemExit("BoM did not answer: not writing a short registry")
    if isinstance(rows, dict):  # BoM's error body
        raise SystemExit(f"BoM refused: {rows.get('message')}")
    return [dict(zip(rows[0], r)) for r in rows[1:]]


def live_series(prefix: str, parameter: str, since: str) -> Dict[str, str]:
    """{station_no: ts_id} of the daily-mean series reaching `since`.
    Numeric ids only: `212213.1` is a sub-station."""
    rows = bom_list(
        request="getTimeseriesList",
        station_no=prefix + "*",
        ts_name=BOM_SERIES,
        parametertype_name=parameter,
        returnfields="station_no,ts_id,coverage",
    )
    return {
        r["station_no"]: r["ts_id"]
        for r in rows
        if r["station_no"].isdigit() and r["to"][:10] >= since
    }


def registry() -> List[dict]:
    since = (datetime.now(AEST) - timedelta(10)).strftime("%Y-%m-%d")
    out: List[dict] = []
    # The hot gauges first: some sit outside the basins, and the cap must
    # never cut one.
    for prefix in [*HOT, *BASINS]:
        level = live_series(prefix, "Water Course Level", since)
        flow = live_series(prefix, "Water Course Discharge", "")
        ids = sorted(level)
        for i in range(0, len(ids), 10):  # a long reply is cut at 16 KB
            for st in bom_list(
                request="getStationList",
                station_no=",".join(ids[i : i + 10]),
                returnfields="station_no,station_name,station_latitude,station_longitude,custom_attributes",
            ):
                lat, lon = (
                    float(st["station_latitude"] or 0),
                    float(st["station_longitude"] or 0),
                )
                inside = NSW_BOX[0] < lat < NSW_BOX[1] and NSW_BOX[2] < lon < NSW_BOX[3]
                if OWNER not in st["DATA_OWNER_NAME"] or not inside:
                    continue
                no = st["station_no"]
                out.append(
                    {
                        "id": no,
                        "name": st["station_name"],
                        "lat": round(lat, 5),
                        "lon": round(lon, 5),
                        "hot": no in HOT,
                        "hasFlow": no in flow,
                        "bomLevelTs": level[no],
                        "bomFlowTs": flow.get(no),
                    }
                )
        print(f"basin {prefix}: {len(out)} gauges so far", flush=True)
        if len({x["id"] for x in out}) >= MAX_GAUGES:
            break
    out = list({g["id"]: g for g in out}.values())[:MAX_GAUGES]
    missing = set(HOT) - {g["id"] for g in out}
    if missing:
        raise SystemExit(f"hot gauges not in the registry: {sorted(missing)}")
    return out


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    r = sub.add_parser("run", help="fetch readings and publish to S3")
    r.add_argument("--bucket", default=os.environ.get("S3_BUCKET_TOPO"))
    sub.add_parser("registry", help="regenerate gauges.json from BoM")
    args = parser.parse_args(argv)
    if args.command == "run":
        if not args.bucket:
            parser.error("run needs --bucket or S3_BUCKET_TOPO")
        run(args.bucket)
    else:
        GAUGES_FILE.write_text(
            "[\n"
            + ",\n".join(json.dumps(g, separators=(",", ":")) for g in registry())
            + "\n]\n"
        )
        print(f"wrote {GAUGES_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
