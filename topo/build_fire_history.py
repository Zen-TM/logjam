#!/usr/bin/env python3
"""
build_fire_history.py
----------------------
Build NPWS Fire History's two products from one read of the polygons:

- a "most-recent fire year" GeoTIFF. Each cell holds the most recent calendar
  year in which that ground was known to have burned, or 0 (nodata) if the
  ground has never burned or has no usable date on record. The vegetation
  layer reads it at job time (FIRE_HISTORY_S3_PATH in pipeline.py) to mark
  ground burnt since its survey.
- the Fire history overlay's vector archive (`NSW_FIRE` in
  shared/src/nswFire.ts): each area with its most recent fire's year, month
  and type.

    python3 build_fire_history.py publish --bucket B           # the monthly ECS task
    python3 build_fire_history.py fetch fire.geojson           # the service's polygons
    python3 build_fire_history.py build --input fire.geojson   # or SEED's shapefile
    python3 build_fire_history.py overlay --input fire.geojson # the archive

`publish` pages through NPWS's ArcGIS map service (SEED's download package
refuses a script), builds both and uploads the raster, the archive, then the
raster's legend, to RASTER_KEY, ARCHIVE_KEY and LEGEND_KEY in the topo bucket.
It does nothing when the service's count and latest dates match the published
legend's, and exits non-zero without uploading when a read comes back short.

Outputs: fire_history_year.tif         (uint16, EPSG:3577, 100 m)
         fire_history_year_legend.json (provenance + year range)
         nsw-fire-history.pmtiles      (vector, z8 to z12)

Source & licence: NPWS Fire History - Wildfires and Prescribed Burns, from
         The Sharing and Enabling Environmental Data (SEED) Portal
         (https://datasets.seed.nsw.gov.au/dataset/fire-history-wildfires-and-prescribed-burns-1e8b6).
         Licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).
         Required attribution: "© State Government of NSW and NSW Department
         of Climate Change, Energy, the Environment and Water 2010". This
         credit must accompany any derived output (this raster, and the
         fire-staleness marking it drives in the vegetation layer) wherever
         shared — see topo/README.md "Data sources & licences" and
         shared/src/geoPdfBaseLayers.ts (GEOPDF_OVERLAY_ATTRIBUTION.vegetation)
         for where it is surfaced in-app and in exported GeoPDFs.
"""

import argparse
import http.client
import json
import math
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Iterable, List, Optional, Set, Tuple

import shapely
from osgeo import gdal, ogr, osr

gdal.UseExceptions()
ogr.UseExceptions()

TARGET_EPSG = 3577  # GDA94 / Australian Albers — metric, equal-area
# 100 m is deliberate: the raster only drives a per-cell "burned since LiDAR
# capture" stale FLAG (warped onto the job DTM at apply time), not a precise
# fire boundary. Fires are large-area, the LiDAR AOIs are small, and a ~100 m
# boundary slop is irrelevant to the flag — while 25 m over all-NSW is 2.6e9
# cells and ~80 per-year rasterize passes (minutes-to-tens-of-minutes + GBs).
RASTER_RESOLUTION_M = 100
NODATA_VALUE = 0  # 0 = never-burned or no usable date on record
MIN_VALID_YEAR = 1900  # rejects the 1899-12-30 NPWS null-sentinel

SERVICE_URL = (
    "https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/"
    "Fire/NPWS_Fire_History/MapServer/0"
)
SOURCE_EPSG = 4283  # GDA94, the service's own
# The service's date fields, which it sends as epoch milliseconds at midnight
# UTC on the day.
DATE_FIELDS = ("StartDate", "EndDate", "VerDate")
RASTER_FIELDS = ("StartDate", "EndDate")
OVERLAY_FIELDS = (*RASTER_FIELDS, "FireType")
PAGE_SIZE = 1000  # the service's maxRecordCount
HTTP_TRIES = 4
# FIRE_HISTORY_S3_PATH's default in pipeline.py reads RASTER_KEY.
# Guard: tests/test_fire_history.py.
RASTER_KEY = "fire/fire_history_year.tif"
LEGEND_KEY = "fire/fire_history_year_legend.json"
# The overlay's archive, its source layer and properties, and its zooms are
# NSW_FIRE's in shared/src/nswFire.ts. Guard: tests/test_fire_overlay.py.
ARCHIVE_KEY = "master/fire/nsw-fire-history.pmtiles"
OVERLAY_LAYER = "fire"
OVERLAY_ZMIN = 8
OVERLAY_ZMAX = 12
OVERLAY_CREDIT = (
    "Fire history © State Government of NSW and NSW Department of Climate"
    " Change, Energy, the Environment and Water 2010 — NPWS Fire History -"
    " Wildfires and Prescribed Burns (CC BY 4.0)"
)
# A build with this many fewer dated polygons than the published one is the
# service losing data, not NPWS removing fires: keep the published raster.
MIN_VALID_RATIO = 0.9
# Twice the November 2026 grid (12975 x 12588). The grid spans every polygon,
# dated or not, so one stray far from NSW would otherwise size the in-memory
# raster past the task's memory. Guard: tests/test_fire_history.py.
MAX_CELLS = 2 * 12975 * 12588
# What a failed read can raise: an HTTP or socket error, a truncated or
# non-JSON body, or an ArcGIS error (query() raises it as a RuntimeError).
READ_ERRORS = (OSError, http.client.HTTPException, ValueError, RuntimeError)

Query = Callable[[dict], dict]


def resolve_fire_date(
    start_date: Optional[date],
    end_date: Optional[date],
    current_year: int,
) -> Optional[date]:
    """Map one feature's (StartDate, EndDate) to a valid fire date, or None.

    Coalesces EndDate -> StartDate: EndDate is preferred when present (it's
    the more precise "fire out" date), falling back to StartDate when the
    fire is still recorded as unclosed. Returns None — meaning "drop this
    feature, it carries no usable fire date" — unless the chosen date exists
    and its year is in [1900, current_year]. That range rejects three known
    data-quality issues in the NPWS export: the 1899-12-30 null-sentinel used
    in place of a real missing date, at least one outright bogus pre-1900
    date (e.g. 1807), and any date recorded in the future.

    Pure stdlib-only logic — no GDAL/OGR — so it unit-tests on any host.
    """
    fire_date = end_date if end_date is not None else start_date
    if fire_date is None:
        return None
    if fire_date.year < MIN_VALID_YEAR or fire_date.year > current_year:
        return None
    return fire_date


def resolve_fire_year(
    start_date: Optional[date],
    end_date: Optional[date],
    current_year: int,
) -> Optional[int]:
    """resolve_fire_date's year: the raster keeps no more."""
    fire_date = resolve_fire_date(start_date, end_date, current_year)
    return None if fire_date is None else fire_date.year


def _ogr_field_to_date(feature: "ogr.Feature", field_index: int) -> Optional[date]:
    """Read an OGR Date field as a python date, or None if unset/null.

    OGR distinguishes "field not set" from "field set to a nonsense date"
    (like the 1899-12-30 sentinel) — IsFieldSetAndNotNull() handles the
    former, resolve_fire_year()'s range check handles the latter.
    """
    if not feature.IsFieldSetAndNotNull(field_index):
        return None
    year, month, day, _hour, _minute, _second, _tz_flag = feature.GetFieldAsDateTime(
        field_index
    )
    return date(year, month, day)


def compute_reprojected_extent(
    src_layer: "ogr.Layer", transform: "osr.CoordinateTransformation"
) -> Tuple[float, float, float, float]:
    """Reproject the source layer's full extent (all features) into the
    target CRS by transforming its four bounding-box corners.

    Returns (xmin, xmax, ymin, ymax) in the target CRS.
    """
    minx, maxx, miny, maxy = src_layer.GetExtent()
    corners = [(minx, miny), (minx, maxy), (maxx, miny), (maxx, maxy)]
    xs: List[float] = []
    ys: List[float] = []
    for lon, lat in corners:
        x, y, _z = transform.TransformPoint(lon, lat)
        xs.append(x)
        ys.append(y)
    return min(xs), max(xs), min(ys), max(ys)


def build_valid_year_layer(
    src_layer: "ogr.Layer",
    transform: "osr.CoordinateTransformation",
    tgt_srs: "osr.SpatialReference",
    current_year: int,
):
    """Copy every feature with a resolvable fire year into a new in-memory
    layer, geometry reprojected to the target CRS, carrying a "fire_year"
    integer attribute. Features with no valid year are dropped here — before
    rasterizing, per the fire-history preprocess spec.

    Returns (mem_ds, mem_layer, valid_count, dropped_count, years_seen).
    mem_ds is returned alongside mem_layer and must be kept alive by the
    caller for as long as mem_layer is used — OGR's Python bindings don't
    keep a Layer's parent DataSource alive on their own, so letting mem_ds
    go out of scope corrupts the returned layer.
    """
    layer_defn = src_layer.GetLayerDefn()
    start_idx = layer_defn.GetFieldIndex("StartDate")
    end_idx = layer_defn.GetFieldIndex("EndDate")
    if start_idx < 0 or end_idx < 0:
        raise ValueError(
            "Source layer is missing StartDate/EndDate fields — "
            f"found fields: {[layer_defn.GetFieldDefn(i).GetName() for i in range(layer_defn.GetFieldCount())]}"
        )

    mem_driver = ogr.GetDriverByName("MEM")
    mem_ds = mem_driver.CreateDataSource("fire_history_valid")
    mem_layer = mem_ds.CreateLayer("fire_valid", srs=tgt_srs, geom_type=ogr.wkbUnknown)
    mem_layer.CreateField(ogr.FieldDefn("fire_year", ogr.OFTInteger))
    mem_layer_defn = mem_layer.GetLayerDefn()

    valid_count = 0
    dropped_count = 0
    years_seen: Set[int] = set()

    src_layer.ResetReading()
    for i, feature in enumerate(src_layer):
        if i and i % 5000 == 0:
            print(f"  scanned {i} features …", flush=True)

        start = _ogr_field_to_date(feature, start_idx)
        end = _ogr_field_to_date(feature, end_idx)
        year = resolve_fire_year(start, end, current_year)
        if year is None:
            dropped_count += 1
            continue

        geom = feature.GetGeometryRef()
        if geom is None:
            dropped_count += 1
            continue

        geom_clone = geom.Clone()
        geom_clone.Transform(transform)

        out_feature = ogr.Feature(mem_layer_defn)
        out_feature.SetGeometry(geom_clone)
        out_feature.SetField("fire_year", year)
        mem_layer.CreateFeature(out_feature)

        valid_count += 1
        years_seen.add(year)

    return mem_ds, mem_layer, valid_count, dropped_count, years_seen


def rasterize_max_year(
    mem_layer: "ogr.Layer",
    years_seen: Set[int],
    extent: Tuple[float, float, float, float],
    tgt_srs: "osr.SpatialReference",
    out_path: str,
):
    """Burn the reprojected, per-feature fire_year attribute into a single
    uint16 band, one distinct year at a time, oldest first.

    RasterizeLayer's ATTRIBUTE burn mode does not guarantee draw order
    matches attribute value across a single call — feature order in the
    source file drives it, not the year. To guarantee "most recent fire
    wins" per cell, we instead call RasterizeLayer once per distinct year,
    ascending, with a constant burn value and an attribute filter restricting
    each call to that year's polygons. Each pass overwrites only the cells
    its polygons cover, so the newest year drawn last always wins ties.
    """
    xmin, xmax, ymin, ymax = extent
    width = int(math.ceil((xmax - xmin) / RASTER_RESOLUTION_M))
    height = int(math.ceil((ymax - ymin) / RASTER_RESOLUTION_M))
    if width * height > MAX_CELLS:
        raise SystemExit(
            f"a {width} x {height} grid is far larger than NSW's: "
            "a polygon lies far outside the state"
        )

    # Burnt in memory (about 330 MB for NSW) and written once: GTiff rewrites
    # a compressed block each pass it leaves the block cache, without reusing
    # the old block's space, so under a 3 GB task the file grew eightfold.
    dst_ds = gdal.GetDriverByName("MEM").Create("", width, height, 1, gdal.GDT_UInt16)
    dst_ds.SetGeoTransform(
        (xmin, RASTER_RESOLUTION_M, 0, ymax, 0, -RASTER_RESOLUTION_M)
    )
    dst_ds.SetProjection(tgt_srs.ExportToWkt())
    band = dst_ds.GetRasterBand(1)
    band.SetNoDataValue(NODATA_VALUE)
    band.Fill(NODATA_VALUE)

    for year in sorted(years_seen):
        mem_layer.SetAttributeFilter(f"fire_year = {year}")
        gdal.RasterizeLayer(dst_ds, [1], mem_layer, burn_values=[year])
        print(
            f"  burned year {year} ({mem_layer.GetFeatureCount()} polygons)", flush=True
        )
    mem_layer.SetAttributeFilter(None)

    gdal.GetDriverByName("GTiff").CreateCopy(
        out_path,
        dst_ds,
        options=["COMPRESS=LZW", "PREDICTOR=2", "TILED=YES", "BIGTIFF=YES"],
    )
    dst_ds = None

    return width, height


# ── The overlay's archive ────────────────────────────────────────────────


def dated_fires(features: Iterable[dict], current_year: int) -> List[tuple]:
    """(date, FireType, geometry) of each polygon with a usable date, newest
    first; a tie on the date goes to the later OBJECTID, so a rebuild draws
    the same map. `features` are dicts of OBJECTID, StartDate, EndDate (dates
    or None), FireType and a shapely geometry."""
    fires = []
    for f in features:
        when = resolve_fire_date(f["StartDate"], f["EndDate"], current_year)
        if when is not None and f["geometry"] is not None:
            fires.append((when, f["OBJECTID"], f["FireType"], f["geometry"]))
    fires.sort(key=lambda fire: fire[:2], reverse=True)
    return [(when, kind, geom) for when, _oid, kind, geom in fires]


def polygonal(geom):
    """The polygons of a geometry, dropping the lines and points that
    make_valid or a difference can leave beside them, or None."""
    # Twice, as a collection can hold a multipolygon.
    parts = shapely.get_parts(shapely.get_parts(geom))
    polygons = [p for p in parts if p.geom_type == "Polygon" and not p.is_empty]
    return shapely.multipolygons(polygons) if polygons else None


def flatten(fires: List[tuple]) -> Iterable[tuple]:
    """Each of `fires` (newest first, as dated_fires gives them) less the
    ground a newer one burnt, so an area keeps only its most recent fire: the
    overlay's tint is translucent, and overlapping fills would add up."""
    geoms = [shapely.make_valid(geom) for _when, _kind, geom in fires]
    tree = shapely.STRtree(geoms)
    for i, (when, kind, _geom) in enumerate(fires):
        geom = geoms[i]
        newer = [j for j in tree.query(geom, predicate="intersects") if j < i]
        if newer:
            geom = shapely.difference(
                geom, shapely.union_all([geoms[j] for j in newer])
            )
        geom = polygonal(geom)
        if geom is not None:
            yield when, kind, geom
        if i and i % 2000 == 0:
            print(f"  flattened {i} of {len(fires)} fires …", flush=True)


def overlay_feature(when: date, kind: Optional[int], geom) -> str:
    """One GeoJSON line for tippecanoe: the properties the clients read."""
    props = {"year": when.year, "month": when.month}
    if kind is not None:
        props["type"] = kind
    return (
        '{"type":"Feature","properties":'
        + json.dumps(props)
        + ',"geometry":'
        + shapely.to_geojson(geom)
        + "}\n"
    )


def read_overlay_features(input_path: str) -> Iterable[dict]:
    """The polygons at input_path (any OGR source with the OVERLAY_FIELDS),
    one at a time, as dated_fires reads them."""
    src_ds = ogr.Open(input_path)
    if src_ds is None:
        raise SystemExit(f"OGR could not open {input_path}")
    layer = src_ds.GetLayer(0)
    defn = layer.GetLayerDefn()
    idx = {name: defn.GetFieldIndex(name) for name in ("OBJECTID", *OVERLAY_FIELDS)}
    missing = [name for name, i in idx.items() if i < 0]
    if missing:
        raise SystemExit(f"{input_path} has no {missing}")
    kind = idx["FireType"]
    for feature in layer:
        geom = feature.GetGeometryRef()
        yield {
            "OBJECTID": feature.GetFieldAsInteger(idx["OBJECTID"]),
            "StartDate": _ogr_field_to_date(feature, idx["StartDate"]),
            "EndDate": _ogr_field_to_date(feature, idx["EndDate"]),
            "FireType": feature.GetFieldAsInteger(kind)
            if feature.IsFieldSetAndNotNull(kind)
            else None,
            "geometry": None
            if geom is None
            else shapely.from_wkb(bytes(geom.ExportToIsoWkb())),
        }


def tippecanoe_command(geojson: Path, out: Path, tmp: Path) -> List[str]:
    return [
        *["tippecanoe", "--force", "-q", "-o", str(out), "-t", str(tmp)],
        *["-l", OVERLAY_LAYER, f"-Z{OVERLAY_ZMIN}", f"-z{OVERLAY_ZMAX}"],
        *["-n", "NPWS Fire History", "-N", OVERLAY_CREDIT],
        # One polygon per run of a fire, with the edges two fires share kept
        # shared, so their outlines draw as one line.
        *["--coalesce", "--reorder", "--detect-shared-borders"],
        # A dropped polygon is ground with no answer to a tap, not a thinner map.
        *["--no-feature-limit", "--no-tile-size-limit"],
        str(geojson),
    ]


def build_overlay(input_path: str, out_path: Path) -> int:
    """Write the overlay's archive to out_path from the polygons at
    input_path, and return how many areas it holds. The source's GDA94 is
    written as WGS84: they are under 2 m apart, well inside the source's own
    accuracy."""
    current_year = datetime.now(timezone.utc).year
    fires = dated_fires(read_overlay_features(input_path), current_year)
    print(f"Flattening {len(fires)} dated fires …", flush=True)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=out_path.parent) as tmp:
        lines = Path(tmp) / "fire.geojsonl"
        areas = 0
        with open(lines, "w", encoding="utf-8") as out:
            for fire in flatten(fires):
                out.write(overlay_feature(*fire))
                areas += 1
        del fires
        print(f"Tiling {areas} areas → {out_path} …", flush=True)
        subprocess.run(tippecanoe_command(lines, out_path, Path(tmp)), check=True)
    return areas


# ── The map service ──────────────────────────────────────────────────────


def query(params: dict) -> dict:
    """One call to the layer's /query, retried; an ArcGIS error, which comes
    back as HTTP 200 with an "error" member, counts as a failure."""
    url = SERVICE_URL + "/query?" + urllib.parse.urlencode(params)
    for attempt in range(HTTP_TRIES):
        try:
            with urllib.request.urlopen(url, timeout=300) as resp:
                doc = json.load(resp)
            if "error" in doc:
                raise RuntimeError(f"service error: {doc['error']}")
            return doc
        except READ_ERRORS as err:
            if attempt == HTTP_TRIES - 1:
                raise
            print(f"  query failed ({err}), retrying …", flush=True)
            time.sleep(15 * 2**attempt)


def esri_date(ms: Optional[int]) -> Optional[str]:
    """An ArcGIS date (epoch ms, UTC) as an ISO date, which OGR's GeoJSON
    reader types as a Date field, as the shapefile's are."""
    if ms is None:
        return None
    try:
        return (datetime(1970, 1, 1) + timedelta(milliseconds=ms)).date().isoformat()
    except OverflowError:  # outside years 1 to 9999: no usable date
        return None


def source_state(get: Query = query) -> dict:
    """The service's polygon count and latest dates: what `publish` compares
    with the published legend to decide whether there is anything new."""
    count = get({"where": "1=1", "returnCountOnly": "true", "f": "json"})["count"]
    stats = [
        {
            "statisticType": "max",
            "onStatisticField": field,
            "outStatisticFieldName": f"latest_{field}",
        }
        for field in DATE_FIELDS
    ]
    row = get({"where": "1=1", "outStatistics": json.dumps(stats), "f": "json"})
    latest = row["features"][0]["attributes"]
    return {
        "service": SERVICE_URL,
        "count": count,
        **{f"latest_{f}": esri_date(latest[f"latest_{f}"]) for f in DATE_FIELDS},
    }


def fetch(
    out_path: Path, fields: Iterable[str], expected: int, get: Query = query
) -> int:
    """Page through every polygon, with `fields`, into one GeoJSON file in
    GDA94; date fields become ISO dates. Fails unless exactly `expected`
    distinct polygons arrived, so a short read never reaches a build, and
    out_path appears only once the read is whole.

    Pages by resultOffset in OBJECTID order. A page that adds nothing new
    ends the read: a server ignoring the offset would otherwise loop. A page
    that fails is asked for again at half the size: the service answers 500
    to a page over its size limit, and its larger polygons make one (the 500
    after offset 30,500 came to 33 MB on 2026-11-07).
    """
    out_fields = ",".join(dict.fromkeys(["OBJECTID", *fields]))
    seen: Set[int] = set()
    offset = 0
    size = PAGE_SIZE
    part = out_path.with_name(out_path.name + ".part")
    with open(part, "w", encoding="utf-8") as out:
        crs = {"type": "name", "properties": {"name": f"EPSG:{SOURCE_EPSG}"}}
        out.write(
            '{"type":"FeatureCollection","crs":' + json.dumps(crs) + ',"features":[\n'
        )
        while True:
            try:
                page = get(
                    {
                        "where": "1=1",
                        "outFields": out_fields,
                        "orderByFields": "OBJECTID",
                        "resultOffset": offset,
                        "resultRecordCount": size,
                        "outSR": SOURCE_EPSG,
                        "f": "geojson",
                    }
                )
            except READ_ERRORS as err:
                # A refused connection or a failed lookup is no page's size.
                unreachable = isinstance(err, urllib.error.URLError) and not (
                    isinstance(err, urllib.error.HTTPError)
                )
                if size == 1 or unreachable:
                    raise
                size //= 2
                print(
                    f"  page at {offset} failed ({err}), asking for {size}", flush=True
                )
                continue
            features = page.get("features", [])
            new = 0
            for feature in features:
                props = feature["properties"]
                if props["OBJECTID"] in seen:
                    continue
                for field in DATE_FIELDS:
                    if field in props:
                        props[field] = esri_date(props[field])
                out.write(("," if seen else "") + json.dumps(feature) + "\n")
                seen.add(props["OBJECTID"])
                new += 1
            offset += len(features)
            print(f"  fetched {len(seen)} of {expected} polygons …", flush=True)
            if not new or not page.get("exceededTransferLimit"):
                break
        out.write("]}\n")
    if len(seen) != expected:
        part.unlink()
        raise SystemExit(
            f"read {len(seen)} polygons but the service counts {expected}: "
            "not building from a partial read"
        )
    part.replace(out_path)
    return len(seen)


# ── Publish ──────────────────────────────────────────────────────────────


def read_legend(s3, bucket: str) -> Optional[dict]:
    """The published legend, or None. Listed first: S3 answers a GetObject
    for a missing key with AccessDenied unless the caller may list the whole
    bucket, and the task role may list only fire/."""
    listed = s3.list_objects_v2(Bucket=bucket, Prefix=LEGEND_KEY, MaxKeys=1)
    if listed.get("KeyCount", 0) == 0:
        return None
    return json.loads(s3.get_object(Bucket=bucket, Key=LEGEND_KEY)["Body"].read())


def publish(bucket: str, s3=None, get: Query = query) -> None:
    if s3 is None:
        import boto3

        s3 = boto3.client("s3")
    state = source_state(get)
    old = read_legend(s3, bucket)
    # A legend from before the overlay has no `overlay` block, so the first
    # run after it ships builds the archive.
    if (
        old is not None
        and old.get("source") == state
        and old.get("overlay", {}).get("archive") == ARCHIVE_KEY
    ):
        print(f"unchanged since the published build: {state}")
        return
    print(f"building from {state}")
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "fire_history.geojson"
        fetch(src, OVERLAY_FIELDS, state["count"], get)
        tif = Path(tmp) / "fire_history_year.tif"
        legend = build(str(src), tif, state)
        if old is not None and legend["valid_feature_count"] < (
            old["valid_feature_count"] * MIN_VALID_RATIO
        ):
            raise SystemExit(
                f"refusing to publish {legend['valid_feature_count']} dated polygons "
                f"over {old['valid_feature_count']}: check the service"
            )
        archive = Path(tmp) / "nsw-fire-history.pmtiles"
        legend["overlay"] = {
            "archive": ARCHIVE_KEY,
            "areas": build_overlay(str(src), archive),
        }
        # The raster and the archive before the legend, so a failed upload
        # leaves an old legend and the next run builds again. Guard:
        # tests/test_fire_history.py, test_a_new_source_uploads_both_then_the_legend.
        s3.upload_file(str(tif), bucket, RASTER_KEY)
        s3.upload_file(
            str(archive),
            bucket,
            ARCHIVE_KEY,
            ExtraArgs={"ContentType": "application/vnd.pmtiles"},
        )
        s3.put_object(
            Bucket=bucket,
            Key=LEGEND_KEY,
            Body=json.dumps(legend, indent=2).encode(),
            ContentType="application/json",
        )
    print(f"published s3://{bucket}/{RASTER_KEY}, {ARCHIVE_KEY} and the legend")


# ── Build ────────────────────────────────────────────────────────────────


def build(input_path: str, out_path: Path, source: dict) -> dict:
    """Rasterize the polygons at input_path (any OGR source with StartDate
    and EndDate dates) to out_path, write the legend beside it and return it.
    `source` goes into the legend as where the polygons came from."""
    src_ds = ogr.Open(input_path)
    if src_ds is None:
        raise SystemExit(f"OGR could not open {input_path}")
    src_layer = src_ds.GetLayer(0)
    src_srs = src_layer.GetSpatialRef()
    if src_srs is None:
        raise SystemExit("source layer has no spatial reference defined")
    print(
        f"  {src_layer.GetFeatureCount()} features, source SRS: {src_srs.GetAuthorityCode(None)}"
    )

    tgt_srs = osr.SpatialReference()
    tgt_srs.ImportFromEPSG(TARGET_EPSG)
    src_srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    tgt_srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    transform = osr.CoordinateTransformation(src_srs, tgt_srs)

    current_year = datetime.now(timezone.utc).year
    print(
        f"Resolving fire years (current_year={current_year}, valid range [{MIN_VALID_YEAR}, {current_year}]) …"
    )
    mem_ds, mem_layer, valid_count, dropped_count, years_seen = build_valid_year_layer(
        src_layer, transform, tgt_srs, current_year
    )
    print(f"  {valid_count} valid, {dropped_count} dropped (no usable fire date)")
    if not years_seen:
        raise SystemExit(
            "zero features had a resolvable fire year — nothing to rasterize"
        )
    print(
        f"  {len(years_seen)} distinct fire years, {min(years_seen)}–{max(years_seen)}"
    )

    print(f"Computing reprojected extent (EPSG:{TARGET_EPSG}) …")
    extent = compute_reprojected_extent(src_layer, transform)
    print(f"  extent (xmin, xmax, ymin, ymax): {extent}")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    print(
        f"Rasterizing → {out_path} (uint16, {RASTER_RESOLUTION_M} m, nodata={NODATA_VALUE}) …"
    )
    width, height = rasterize_max_year(
        mem_layer, years_seen, extent, tgt_srs, str(out_path)
    )
    print(f"  raster size: {width} x {height}")

    legend = {
        "description": (
            "NPWS Fire History → most-recent-fire-year raster. Pixel value is "
            "the most recent calendar year known to have burned that ground; "
            "0 (nodata) means never-burned or no usable date on record."
        ),
        "source": source,
        "build_date_utc": datetime.now(timezone.utc).isoformat(),
        "crs": f"EPSG:{TARGET_EPSG}",
        "resolution_m": RASTER_RESOLUTION_M,
        "nodata": NODATA_VALUE,
        "min_fire_year": min(years_seen),
        "max_fire_year": max(years_seen),
        "valid_feature_count": valid_count,
        "dropped_feature_count": dropped_count,
        "total_feature_count": valid_count + dropped_count,
    }
    legend_path = out_path.with_name(out_path.stem + "_legend.json")
    with open(legend_path, "w") as f:
        json.dump(legend, f, indent=2)
    print(f"Wrote legend → {legend_path}")
    return legend


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("publish", help="build from the service and upload to S3")
    p.add_argument("--bucket", default=os.environ.get("S3_BUCKET_TOPO"))
    f = sub.add_parser("fetch", help="write the service's polygons to one GeoJSON")
    f.add_argument("output", type=Path)
    b = sub.add_parser("build", help="rasterize a local file")
    b.add_argument(
        "--input",
        required=True,
        help="The polygons: `fetch`'s GeoJSON or SEED's shapefile (.shp).",
    )
    b.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).parent / "fire" / "fire_history_year.tif",
        help="Output fire-year raster path.",
    )
    o = sub.add_parser("overlay", help="build the overlay's archive from a local file")
    o.add_argument("--input", required=True, help="`fetch`'s GeoJSON.")
    o.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).parent / "fire" / "nsw-fire-history.pmtiles",
    )
    args = parser.parse_args(argv)

    if args.command == "publish":
        if not args.bucket:
            parser.error("publish needs --bucket or S3_BUCKET_TOPO")
        publish(args.bucket)
    elif args.command == "fetch":
        state = source_state()
        print(f"fetching {state}")
        fetch(args.output, OVERLAY_FIELDS, state["count"])
    elif args.command == "overlay":
        print(f"{build_overlay(args.input, args.output)} areas")
    else:
        if not os.path.exists(args.input):
            parser.error(f"input not found: {args.input}")
        print(f"Opening: {args.input}")
        build(args.input, args.output, {"file": os.path.basename(args.input)})
    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
