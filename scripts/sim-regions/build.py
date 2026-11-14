#!/usr/bin/env python3
"""Builds the simulated regions' archives from boxes.json. Run by build.sh in the
topo worker image; see README.md.

    build.py [--only simnz,simutah,world] [--step heights,slope,...] [--fixtures] [--force]

Writes under /out (out/master/<kind>/<id>-... is the layout the CDN serves), and
with --fixtures a small cut of each archive under /fixtures. A step whose output
exists is skipped, so a run that stopped carries on; --force redoes everything.
"""

import argparse
import json
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOPO = Path("/app")  # the worker image
sys.path.insert(0, str(TOPO))

STEPS = ("heights", "slope", "contours", "vector", "places", "lidar")
# What this script's own requests send to other people's servers: nothing that
# names the project or its maintainer (guard: shared/src/simRegionsBuild.test.ts,
# "sends a user agent that names no project or person"). The height builder has
# its own, build_region_dem.USER_AGENT.
BROWSER_AGENT = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0"
BUILDS = "https://build-metadata.protomaps.dev/builds.json"
PROTOMAPS = "https://build.protomaps.com/{}.pmtiles"
OVERPASS = "https://overpass-api.de/api/map?bbox={0},{1},{2},{3}"
WAIT_S = 120  # a host that refused us is left alone this long, then doubled


def say(text: str) -> None:
    print(f"==> {text}", flush=True)


def run(*command: str) -> None:
    say(" ".join(command))
    subprocess.run(command, check=True)


def retrying(what: str, attempt, tries: int = 5):
    """`attempt()` until it works. A refusal (429 or 503, from urllib or from a
    child's output reaching us as a failure) waits a growing time, never retries
    at once."""
    wait = WAIT_S
    for n in range(1, tries + 1):
        try:
            return attempt()
        except (urllib.error.URLError, subprocess.CalledProcessError, OSError) as e:
            if n == tries:
                raise
            say(f"{what} failed ({e}); waiting {wait} s ({n}/{tries})")
            time.sleep(wait)
            wait *= 2


def download(url: str, dest: Path, data: bytes | None = None) -> None:
    def attempt():
        request = urllib.request.Request(
            url, data=data, headers={"User-Agent": BROWSER_AGENT}
        )
        part = dest.with_suffix(dest.suffix + ".part")
        with urllib.request.urlopen(request, timeout=300) as r, open(part, "wb") as f:
            shutil.copyfileobj(r, f)
        part.rename(dest)

    dest.parent.mkdir(parents=True, exist_ok=True)
    retrying(url, attempt)


def bbox_arg(box) -> str:
    # `=`: a negative west would read as another flag.
    return "--bbox=" + ",".join(map(str, box))


def grown(box, margin: float):
    west, south, east, north = box
    return [west - margin, south - margin, east + margin, north + margin]


def region_geojson(boxes, path: Path) -> None:
    """The boxes as one MultiPolygon, the `--region` of `pmtiles extract`."""
    polygons = [[[[w, s], [e, s], [e, n], [w, n], [w, s]]] for w, s, e, n in boxes]
    path.write_text(
        json.dumps(
            {
                "type": "Feature",
                "properties": {},
                "geometry": {"type": "MultiPolygon", "coordinates": polygons},
            }
        )
    )


def merged(parts: list[Path], out: Path) -> None:
    """One archive from disjoint ones."""
    out.parent.mkdir(parents=True, exist_ok=True)
    if len(parts) == 1:
        shutil.copy(parts[0], out)
    else:
        out.unlink(missing_ok=True)
        run("pmtiles", "merge", *map(str, parts), str(out))


def fit_bounds(archive: Path) -> None:
    """Make the metadata's `bounds` and `center` the header's. A merge keeps the
    first input's metadata, and a reader of the metadata would take an archive of
    two boxes to cover one."""

    def shown(flag: str) -> dict:
        return json.loads(
            subprocess.check_output(["pmtiles", "show", flag, str(archive)])
        )

    header, meta = shown("--header-json"), shown("--metadata")
    west, south, east, north = header["bounds"]
    meta["bounds"] = f"{west},{south},{east},{north}"
    meta["center"] = f"{(west + east) / 2},{(south + north) / 2},{header['minzoom']}"
    fixed = archive.with_suffix(".metadata.json")
    fixed.write_text(json.dumps(meta))
    run("pmtiles", "edit", str(archive), f"--metadata={fixed}")
    fixed.unlink()


def heights(rid: str, cfg: dict, out: Path, work: Path) -> None:
    h = cfg["heights"]
    parts = []
    for n, box in enumerate(cfg["boxes"]):
        part = work / f"{rid}-heights-{n}.pmtiles"
        if not part.exists():
            run(
                "python3",
                str(TOPO / "build_region_dem.py"),
                "heights",
                bbox_arg(box),
                "--zmax",
                str(h["zmax"]),
                "--zmin",
                str(h["zmin"]),
                "--jobs",
                "3",
                "--credit",
                h["credit"],
                "--name",
                h["name"],
                str(part),
            )
        parts.append(part)
    merged(parts, out / h["path"])


def slope(rid: str, cfg: dict, out: Path, work: Path) -> None:
    target = out / cfg["slope"]["path"]
    target.parent.mkdir(parents=True, exist_ok=True)
    run(
        "python3",
        str(TOPO / "build_nsw_dem.py"),
        "slope",
        str(out / cfg["heights"]["path"]),
        str(target),
        "--work",
        str(work / f"{rid}-slope"),
        "--jobs",
        "3",
    )


def contours(rid: str, cfg: dict, out: Path, work: Path) -> None:
    target = out / cfg["contours"]["path"]
    target.parent.mkdir(parents=True, exist_ok=True)
    run(
        "python3",
        str(TOPO / "build_nsw_dem.py"),
        "contours-archive",
        str(out / cfg["heights"]["path"]),
        str(work / f"{rid}-contours"),
        str(target),
    )


def latest_build() -> str:
    def attempt():
        request = urllib.request.Request(BUILDS, headers={"User-Agent": BROWSER_AGENT})
        with urllib.request.urlopen(request, timeout=60) as r:
            return json.load(r)

    builds = retrying(BUILDS, attempt)
    return max(b["key"] for b in builds).removesuffix(".pmtiles")


def vector(rid: str, cfg: dict, out: Path, work: Path, build: str) -> None:
    v = cfg["vector"]
    target = out / v["path"]
    target.parent.mkdir(parents=True, exist_ok=True)
    region = work / f"{rid}-vector.geojson"
    region_geojson([grown(b, v["margin"]) for b in cfg["boxes"]], region)
    part = target.with_suffix(".part")
    retrying(
        "pmtiles extract",
        lambda: run(
            "pmtiles",
            "extract",
            PROTOMAPS.format(build),
            str(part),
            f"--region={region}",
            f"--maxzoom={v['maxzoom']}",
        ),
    )
    part.rename(target)


def places(rid: str, cfg: dict, out: Path, work: Path) -> None:
    """OpenStreetMap inside each box, as an .osm file for the place registry
    (OVERPASS is a GET of one box), and a registry built from it as a check
    that it reads. One file a box: joining two would put one box's nodes after
    the other's ways, and the registry builder needs nodes first."""
    for n, box in enumerate(cfg["boxes"]):
        name = f"{rid}-{n}"
        osm = out / "places" / f"{name}.osm"
        if not osm.exists():
            download(OVERPASS.format(*box), osm)
        run(
            "python3",
            str(TOPO / "build_place_registry.py"),
            "build",
            str(osm),
            str(out / "places" / name),
        )


def lidar(rid: str, cfg: dict, out: Path, work: Path) -> None:
    download(cfg["lidar"]["url"], out / cfg["lidar"]["path"])


def fixtures(rid: str, cfg: dict, out: Path, dest: Path) -> None:
    """A tile or two of each archive, over one small box, for the zooms it names."""
    f = cfg["fixture"]
    for kind in ("heights", "slope", "contours", "vector"):
        if kind not in cfg:
            continue
        source = out / cfg[kind]["path"]
        target = dest / Path(cfg[kind]["path"]).name
        target.unlink(missing_ok=True)
        run(
            "pmtiles",
            "extract",
            str(source),
            str(target),
            bbox_arg(f["bbox"]),
            f"--minzoom={cfg[kind]['fixtureZooms'][0]}",
            f"--maxzoom={cfg[kind]['fixtureZooms'][1]}",
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--only", help="regions, comma separated")
    parser.add_argument("--step", help=f"one or more of {', '.join(STEPS)}")
    parser.add_argument("--fixtures", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--protomaps-build", help="a build date, e.g. 20261113")
    args = parser.parse_args()

    regions = json.loads((HERE / "boxes.json").read_text())["regions"]
    only = args.only.split(",") if args.only else list(regions)
    steps = args.step.split(",") if args.step else list(STEPS)
    unknown = [r for r in only if r not in regions] + [
        s for s in steps if s not in STEPS
    ]
    if unknown:
        sys.exit(f"unknown: {', '.join(unknown)}")
    out, work = Path("/out"), Path("/out/work")
    if args.force:
        shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True, exist_ok=True)
    build = None
    for rid in only:
        cfg = regions[rid]
        for step in steps:
            if step not in cfg:
                continue
            target = (
                out / "places" / f"{rid}-{len(cfg['boxes']) - 1}" / "latest.json"
                if step == "places"
                else out / cfg[step]["path"]
            )
            if target.exists() and not args.force:
                say(f"{rid} {step}: {target} exists")
                continue
            say(f"{rid} {step}")
            if step == "vector":
                build = build or args.protomaps_build or latest_build()
                vector(rid, cfg, out, work, build)
            else:
                globals()[step](rid, cfg, out, work)
        if len(cfg["boxes"]) > 1:
            for kind in ("heights", "slope", "contours", "vector"):
                if kind in cfg and (out / cfg[kind]["path"]).exists():
                    fit_bounds(out / cfg[kind]["path"])
        if args.fixtures:
            dest = Path("/fixtures")
            dest.mkdir(parents=True, exist_ok=True)
            fixtures(rid, cfg, out, dest)


if __name__ == "__main__":
    main()
