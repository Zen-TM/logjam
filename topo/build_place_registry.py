#!/usr/bin/env python3
"""
build_place_registry.py
-----------------------
Builds the place registry that Logjam's location search reads: every named
OpenStreetMap feature in NSW, one row each, from Geofabrik's NSW extract.
Why a registry, and why it is public: ADR 0034.

    python3 build_place_registry.py build new-south-wales-latest.osm.pbf out/
    python3 build_place_registry.py measure new-south-wales-latest.osm.pbf

`build` writes `places-<version>.json.gz` (the format is `PlaceRegistryFile`
in shared/src/placeRegistry.ts) and `latest.json`, the pointer clients read.
`publish` builds from a fresh download and uploads both to the topo bucket,
pointer last; it is what the monthly ECS task runs. `measure` prints the size
each class of feature adds, which is how the rules below were chosen.

Source and licence: OpenStreetMap, © OpenStreetMap contributors, under the
ODbL 1.0. The public copy under master/places/v1/ is the offer of the derived
database the ODbL asks for.
"""

import argparse
import gzip
import hashlib
import json
import math
import os
import socket
import sys
import tempfile
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

FORMAT = 1
EXTRACT_URL = (
    "https://download.geofabrik.de/australia-oceania/australia/"
    "new-south-wales-latest.osm.pbf"
)
ATTRIBUTION = "© OpenStreetMap contributors"
LICENCE = "ODbL-1.0"
# PLACE_REGISTRY_PREFIX in shared/src/placeRegistry.ts. Guard:
# tests/test_place_registry.py.
S3_PREFIX = f"master/places/v{FORMAT}/"

# The tag that says what a feature is, in the order a feature with several is
# read: `natural=peak` on a node that also has `tourism=viewpoint` is a peak.
KIND_KEYS = (
    "place",
    "natural",
    "waterway",
    "water",
    "boundary",
    "leisure",
    "tourism",
    "historic",
    "highway",
    "railway",
    "aeroway",
    "amenity",
    "landuse",
    "man_made",
    "shop",
    "office",
    "building",
)

# Whole classes left out, each because it adds rows and no search a canyoner
# makes: `(key, value)`, or `(key, None)` for any value. A feature is kept
# only with a `name` and one of KIND_KEYS, and not matched here. Guard:
# tests/test_place_registry.py.
EXCLUDED = {
    # A route's name is the line's ("Route 123: Penrith => Katoomba").
    ("type", "route"),
    # A council area spells a town's name again ("Blue Mountains City").
    ("boundary", "administrative"),
    # A stop or platform name repeats its street's.
    ("public_transport", None),
    ("highway", "bus_stop"),
    ("highway", "platform"),
    ("railway", "platform"),
}

# Keys whose features are lines even when the way closes: a loop track or a
# ring road reads as a line, and merges with its open segments.
LINEAR_KEYS = {"highway", "waterway", "railway"}

# Settlements a result is placed "near", for telling two Main Streets apart.
SETTLEMENTS = {"city", "town", "village", "suburb", "hamlet", "locality"}
ALTERNATE_KEYS = ("alt_name", "loc_name", "old_name", "official_name", "short_name")
# Segments of one creek or street more than this far from each other are two
# features, even with the same name.
MERGE_GAP_DEG = 0.05  # about 5 km
COORD_DP = 5  # about 1 m


def kind_of(tags: Dict[str, str]) -> Optional[str]:
    """The feature's kind as `key=value`, or None to leave it out."""
    for key, value in EXCLUDED:
        if key in tags and (value is None or tags[key] == value):
            return None
    for key in KIND_KEYS:
        value = tags.get(key)
        if value is not None and value != "no":
            return f"{key}={value}"
    return None


def is_line(tags: Dict[str, str], kind: str) -> bool:
    """Whether a closed way is read as a line, not an area."""
    return tags.get("area") == "no" or (
        kind.split("=")[0] in LINEAR_KEYS and tags.get("area") != "yes"
    )


def alternates_of(tags: Dict[str, str], name: str) -> List[str]:
    seen = {name}
    out = []
    for key in ALTERNATE_KEYS:
        for value in tags.get(key, "").split(";"):
            value = value.strip()
            if value and value not in seen:
                seen.add(value)
                out.append(value)
    return out


class Raw:
    """One named OSM object before merging. `bbox` is (west, south, east,
    north); `line` is an open way, whose neighbours merge into it."""

    __slots__ = ("name", "kind", "lon", "lat", "alternates", "bbox", "line")

    def __init__(self, name, kind, lon, lat, alternates, bbox=None, line=False):
        self.name = name
        self.kind = kind
        self.lon = lon
        self.lat = lat
        self.alternates = alternates
        self.bbox = bbox or (lon, lat, lon, lat)
        self.line = line


def read_extract(pbf: str) -> Iterable[Raw]:
    """Every named, kept object in the extract, with a point on it."""
    import osmium  # only the builder needs it, not the tests

    processor = (
        osmium.FileProcessor(pbf)
        .with_locations()
        .with_areas()
        .with_filter(osmium.filter.KeyFilter("name"))
    )
    for obj in processor:
        tags = {t.k: t.v for t in obj.tags}
        name = tags.get("name", "").strip()
        if not name:
            continue
        kind = kind_of(tags)
        if kind is None:
            continue
        alternates = alternates_of(tags, name)
        if obj.is_node():
            if obj.location.valid():
                loc = obj.location
                yield Raw(name, kind, loc.lon, loc.lat, alternates)
        elif obj.is_way():
            # A closed way comes back as an area too, and is read there,
            # unless it is a line.
            if not obj.is_closed() or is_line(tags, kind):
                located = [n.location for n in obj.nodes if n.location.valid()]
                if located:
                    yield line_raw(name, kind, alternates, located)
        elif obj.is_area():
            if obj.from_way() and is_line(tags, kind):
                continue  # read as a line above
            ring = [
                n.location
                for outer in obj.outer_rings()
                for n in outer
                if n.location.valid()
            ]
            if ring:
                yield area_raw(name, kind, alternates, ring)


def bbox_of(locations) -> Tuple[float, float, float, float]:
    lons = [loc.lon for loc in locations]
    lats = [loc.lat for loc in locations]
    return (min(lons), min(lats), max(lons), max(lats))


def line_raw(name, kind, alternates, located) -> Raw:
    # The middle node: a point on the line, where a centre may not be.
    mid = located[len(located) // 2]
    return Raw(name, kind, mid.lon, mid.lat, alternates, bbox_of(located), True)


def area_raw(name, kind, alternates, ring) -> Raw:
    # ponytail: bbox centre, which can fall outside a U-shaped park; a
    # pole-of-inaccessibility point if recentring there ever looks wrong.
    w, s, e, n = bbox_of(ring)
    return Raw(name, kind, (w + e) / 2, (s + n) / 2, alternates, (w, s, e, n))


class Grid:
    """Nearest-settlement lookup over a coarse lon/lat grid."""

    CELL = 0.1

    def __init__(self, points: List[Tuple[float, float, int]]):
        self.cells: Dict[Tuple[int, int], List[Tuple[float, float, int]]] = defaultdict(
            list
        )
        for p in points:
            self.cells[self._key(p[0], p[1])].append(p)

    def _key(self, lon, lat):
        return (math.floor(lon / self.CELL), math.floor(lat / self.CELL))

    def nearest(
        self, lon: float, lat: float, exclude: int = -1, max_rings: int = 5
    ) -> Optional[int]:
        """The closest point other than `exclude` within `max_rings` cells,
        or None."""
        cx, cy = self._key(lon, lat)
        shrink = math.cos(math.radians(lat))  # a degree of lon is shorter
        best, best_d = None, math.inf
        for ring in range(max_rings + 1):
            for dx in range(-ring, ring + 1):
                for dy in range(-ring, ring + 1):
                    if max(abs(dx), abs(dy)) != ring:
                        continue
                    for plon, plat, idx in self.cells.get((cx + dx, cy + dy), ()):
                        d = math.hypot((plon - lon) * shrink, plat - lat)
                        if d < best_d and idx != exclude:
                            best, best_d = idx, d
            # Anything in a further ring is at least this far away.
            if best is not None and best_d <= ring * self.CELL * shrink:
                return best
        return best


def is_settlement(kind: str) -> bool:
    return kind.startswith("place=") and kind[len("place=") :] in SETTLEMENTS


def merge(raws: Iterable[Raw]) -> List[Raw]:
    """One row per feature: the segments of a creek or a street become one.

    Objects merge when they share a name, lie within MERGE_GAP_DEG of each
    other (bbox to bbox, chained), and either are both lines of one kind key
    (a street that is `residential` in town and `tertiary` beyond, a creek
    that is a `stream` and then a `river`) or have the same kind. The merged
    row takes its members' commonest kind, and the member point nearest
    their mean, so the point stays on the feature.
    """
    groups: Dict[tuple, List[Raw]] = defaultdict(list)
    for raw in raws:
        kind = raw.kind.split("=")[0] if raw.line else raw.kind
        groups[(raw.name, kind, raw.line)].append(raw)

    out = []
    for members in groups.values():
        for cluster in clusters_of(members):
            mlon = sum(m.lon for m in cluster) / len(cluster)
            mlat = sum(m.lat for m in cluster) / len(cluster)
            pick = min(cluster, key=lambda m: (m.lon - mlon) ** 2 + (m.lat - mlat) ** 2)
            kind = Counter(m.kind for m in cluster).most_common(1)[0][0]
            alternates: List[str] = []
            for m in cluster:
                alternates += [a for a in m.alternates if a not in alternates]
            out.append(Raw(pick.name, kind, pick.lon, pick.lat, alternates))
    return out


def clusters_of(members: List[Raw]) -> List[List[Raw]]:
    """Members chained by bboxes within MERGE_GAP_DEG, by union-find."""
    parent = list(range(len(members)))

    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    # Sweep in west-edge order: once a member starts beyond the gap east of
    # this one's east edge, no later member can touch it.
    order = sorted(range(len(members)), key=lambda i: members[i].bbox[0])
    for a_at, a in enumerate(order):
        aw, as_, ae, an = members[a].bbox
        for b in order[a_at + 1 :]:
            bw, bs, be, bn = members[b].bbox
            if bw > ae + MERGE_GAP_DEG:
                break
            if bs <= an + MERGE_GAP_DEG and bn >= as_ - MERGE_GAP_DEG:
                parent[root(a)] = root(b)
    clusters: Dict[int, List[Raw]] = defaultdict(list)
    for i, m in enumerate(members):
        clusters[root(i)].append(m)
    return list(clusters.values())


def registry(raws: Iterable[Raw], version: str) -> dict:
    """The file's JSON, as `PlaceRegistryFile` in shared/src/placeRegistry.ts."""
    rows = merge(raws)
    # Settlements first, so a row's `near` is a small index and a reader can
    # resolve it without a second pass.
    rows.sort(key=lambda r: (not is_settlement(r.kind), r.name, r.lon))
    settlements = [
        (r.lon, r.lat, i) for i, r in enumerate(rows) if is_settlement(r.kind)
    ]
    grid = Grid(settlements)
    kinds: List[str] = []
    kind_index: Dict[str, int] = {}
    rows_out = []
    for i, r in enumerate(rows):
        if r.kind not in kind_index:
            kind_index[r.kind] = len(kinds)
            kinds.append(r.kind)
        # A settlement is placed near another: two Alpines need telling apart.
        near = grid.nearest(r.lon, r.lat, exclude=i)
        row = [
            r.name,
            kind_index[r.kind],
            round(r.lon, COORD_DP),
            round(r.lat, COORD_DP),
            -1 if near is None else near,
        ]
        if r.alternates:
            row.append(r.alternates)
        rows_out.append(row)
    return {
        "format": FORMAT,
        "version": version,
        "attribution": ATTRIBUTION,
        "licence": LICENCE,
        "kinds": kinds,
        "rows": rows_out,
    }


def encode(doc: dict) -> bytes:
    raw = json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode()
    # mtime=0 so the same extract always builds the same bytes.
    return gzip.compress(raw, compresslevel=9, mtime=0)


def extract_version(pbf: str) -> str:
    """The extract's replication date, `YYYY-MM-DD`: the file's version."""
    import osmium

    header = osmium.io.Reader(pbf, osmium.osm.osm_entity_bits.NOTHING).header()
    stamp = header.get("osmosis_replication_timestamp")
    if stamp:
        return stamp[:10]
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def build(pbf: str, out_dir: str) -> Tuple[Path, Path]:
    doc = registry(read_extract(pbf), extract_version(pbf))
    return build_files(doc, Path(out_dir))


def build_files(doc: dict, out: Path) -> Tuple[Path, Path]:
    """The data file and its pointer, `latest.json`, in `out`."""
    body = encode(doc)
    out.mkdir(parents=True, exist_ok=True)
    # The hash keeps a rebuild of the same extract from overwriting a file
    # the CDN and phones cache as immutable.
    digest = hashlib.sha256(body).hexdigest()[:8]
    data_path = out / f"places-{doc['version']}-{digest}.json.gz"
    data_path.write_bytes(body)
    pointer_path = out / "latest.json"
    pointer_path.write_text(
        json.dumps(pointer(doc["version"], data_path.name, len(body))) + "\n"
    )
    return data_path, pointer_path


def pointer(version: str, file_name: str, size: int) -> dict:
    """`latest.json`, as `PlaceRegistryPointer` in shared/src/placeRegistry.ts."""
    return {"format": FORMAT, "version": version, "path": file_name, "bytes": size}


def measure(pbf: str) -> None:
    """Rows and gzipped bytes each kind key adds, largest first."""
    raws = list(read_extract(pbf))
    by_key: Dict[str, List[Raw]] = defaultdict(list)
    for r in raws:
        by_key[r.kind.split("=")[0]].append(r)
    total = len(encode(registry(raws, "measure")))
    print(
        f"all kept: {len(raws)} objects, {len(merge(raws))} rows, {total / 1e6:.2f} MB gz"
    )
    rows = []
    for key, members in by_key.items():
        without = [r for r in raws if r.kind.split("=")[0] != key]
        size = total - len(encode(registry(without, "measure")))
        top = Counter(r.kind for r in members).most_common(4)
        rows.append((size, key, len(members), top))
    for size, key, count, top in sorted(rows, reverse=True):
        print(f"{key:12} {count:8} objects {size / 1e6:6.2f} MB gz  {top}")


# A build this much smaller than the one it replaces is a truncated download
# or a broken extract, not a month of OSM edits; every phone would fetch it.
MIN_SIZE_RATIO = 0.8


def upload(s3, bucket: str, data_path: Path, pointer_path: Path) -> None:
    """The data file first, then the pointer, so no client reads a pointer to
    a file that is not there yet. Guard: tests/test_place_registry.py.

    The current pointer is listed before it is read: S3 answers a GetObject
    for a missing key with AccessDenied unless the caller may list the whole
    bucket, and the task role may list only master/places/."""
    size = data_path.stat().st_size
    key = S3_PREFIX + "latest.json"
    listed = s3.list_objects_v2(Bucket=bucket, Prefix=key, MaxKeys=1)
    current = None
    if listed.get("KeyCount", 0) > 0:
        current = json.loads(s3.get_object(Bucket=bucket, Key=key)["Body"].read())
    if current is not None:
        if not isinstance(current, dict) or not isinstance(current.get("bytes"), int):
            raise SystemExit("the current pointer is unreadable: fix it by hand")
        if size < current["bytes"] * MIN_SIZE_RATIO:
            raise SystemExit(
                f"refusing to publish {size} bytes over {current['bytes']}: "
                "check the extract"
            )
    # A versioned file never changes once written; the pointer always can.
    s3.upload_file(
        str(data_path),
        bucket,
        S3_PREFIX + data_path.name,
        ExtraArgs={
            "ContentType": "application/gzip",
            "CacheControl": "public, max-age=31536000, immutable",
        },
    )
    s3.upload_file(
        str(pointer_path),
        bucket,
        S3_PREFIX + "latest.json",
        ExtraArgs={
            "ContentType": "application/json",
            "CacheControl": "public, max-age=300",
        },
    )


def publish(bucket: str) -> None:
    """Download the extract, build, and upload."""
    import boto3

    # A stalled download would otherwise hang the task with no failure to
    # alarm on.
    socket.setdefaulttimeout(300)
    with tempfile.TemporaryDirectory() as tmp:
        pbf = os.path.join(tmp, "nsw.osm.pbf")
        urllib.request.urlretrieve(EXTRACT_URL, pbf)
        data_path, pointer_path = build(pbf, os.path.join(tmp, "out"))
        upload(boto3.client("s3"), bucket, data_path, pointer_path)
        print(f"published {data_path.name} ({data_path.stat().st_size} bytes)")


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    b = sub.add_parser("build", help="build the registry from a local extract")
    b.add_argument("pbf")
    b.add_argument("out_dir")
    m = sub.add_parser("measure", help="print the size each class adds")
    m.add_argument("pbf")
    p = sub.add_parser("publish", help="download, build and upload to S3")
    p.add_argument("--bucket", default=os.environ.get("S3_BUCKET_TOPO"))
    args = parser.parse_args(argv)
    if args.command == "build":
        data_path, _ = build(args.pbf, args.out_dir)
        print(f"wrote {data_path} ({data_path.stat().st_size} bytes)")
    elif args.command == "measure":
        measure(args.pbf)
    else:
        if not args.bucket:
            parser.error("publish needs --bucket or S3_BUCKET_TOPO")
        publish(args.bucket)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
