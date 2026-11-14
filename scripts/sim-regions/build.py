#!/usr/bin/env python3
"""Builds the simulated regions' archives from boxes.json. Run by build.sh in the
topo worker image; see README.md.

    build.py [--only simnz,simutah,world] [--step heights,slope,...] [--fixtures] [--force]

Writes under /out (out/master/<kind>/<id>-... is the layout the CDN serves), and
with --fixtures a small cut of each archive under /fixtures. An archive is built
under a `.part` name and renamed when whole, so a file at its final name is a
finished one: a step whose output exists is skipped, and a run that stopped
carries on. --force redoes everything, including the files fetched from the
network.
"""

import argparse
import http.client
import json
import re
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


def run(*command: str, capture_stderr: bool = False) -> None:
    """Run a command, echoing it. With `capture_stderr` its stderr is kept on the
    error that a failure raises, for `retriable`, and echoed after it ends."""
    say(" ".join(command))
    done = subprocess.run(
        command,
        check=False,
        stderr=subprocess.PIPE if capture_stderr else None,
        text=True,
    )
    if capture_stderr and done.stderr:
        print(done.stderr, file=sys.stderr, flush=True)
    if done.returncode:
        raise subprocess.CalledProcessError(
            done.returncode, command, stderr=done.stderr
        )


RETRY_STATUS = (429, 500, 502, 503, 504)
# How go-pmtiles words a refusal ("HTTP error: 429") and a dropped connection,
# which is all of its errors that waiting can cure.
RETRY_STDERR = re.compile(
    rf"HTTP error: ({'|'.join(map(str, RETRY_STATUS))})\b"
    r"|connection (refused|reset)|i/o timeout|TLS handshake timeout"
    r"|unexpected EOF|: EOF\b"
)


def retriable(error: BaseException) -> bool:
    """Whether a host's refusal or a dropped connection, which waiting may cure,
    and not a wrong URL, a bad argument, a full disk or a missing binary, which
    it will not (guard: topo/tests/test_sim_regions_build.py `TestRetriable`)."""
    if isinstance(error, urllib.error.HTTPError):
        return error.code in RETRY_STATUS
    if isinstance(error, urllib.error.URLError | http.client.HTTPException):
        return True
    if isinstance(error, subprocess.CalledProcessError):
        return bool(RETRY_STDERR.search(error.stderr or ""))
    return isinstance(error, ConnectionError | TimeoutError)


def retrying(what: str, attempt, tries: int = 5):
    """`attempt()` until it works. What `retriable` accepts waits a growing time,
    never retries at once; anything else fails at once."""
    wait = WAIT_S
    for n in range(1, tries + 1):
        try:
            return attempt()
        except Exception as e:
            if n == tries or not retriable(e):
                raise
            say(f"{what} failed ({e}); waiting {wait} s ({n}/{tries})")
            time.sleep(wait)
            wait *= 2


def written(target: Path, build) -> None:
    """`build(path)` writes the file under a `.part` name, which becomes `target`
    only when it returns, so `target` exists only whole (guard:
    topo/tests/test_sim_regions_build.py `TestWritten`)."""
    target.parent.mkdir(parents=True, exist_ok=True)
    part = target.with_name(target.name + ".part")
    part.unlink(missing_ok=True)
    build(part)
    part.rename(target)


def download(url: str, dest: Path) -> None:
    def fetch(part: Path) -> None:
        request = urllib.request.Request(url, headers={"User-Agent": BROWSER_AGENT})
        with urllib.request.urlopen(request, timeout=300) as r, open(part, "wb") as f:
            shutil.copyfileobj(r, f)

    retrying(url, lambda: written(dest, fetch))


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
    if len(parts) == 1:
        written(out, lambda part: shutil.copy(parts[0], part))
    else:
        written(out, lambda part: run("pmtiles", "merge", *map(str, parts), str(part)))


def fit_metadata(archive: Path, scratch: Path) -> None:
    """Make the metadata's `bounds`, `center`, `minzoom` and `maxzoom` the
    header's, when they differ. A merge keeps the first input's metadata, and
    `pmtiles extract` the source's, so a reader of the metadata would take an
    archive of two boxes to cover one, or a fixture of a tile to hold a whole
    archive's zooms (guard: shared/src/simRegionsBuild.test.ts, "keeps each
    fixture's metadata to what its header says")."""

    def shown(flag: str) -> dict:
        return json.loads(
            subprocess.check_output(["pmtiles", "show", flag, str(archive)])
        )

    header, meta = shown("--header-json"), shown("--metadata")
    west, south, east, north = header["bounds"]
    now = [float(v) for v in meta.get("bounds", "0,0,0,0").split(",")]
    if (
        all(map(lambda a, b: abs(a - b) < 1e-6, now, header["bounds"]))
        and meta.get("minzoom") == str(header["minzoom"])
        and meta.get("maxzoom") == str(header["maxzoom"])
    ):
        return
    meta["bounds"] = f"{west},{south},{east},{north}"
    meta["center"] = f"{(west + east) / 2},{(south + north) / 2},{header['minzoom']}"
    meta["minzoom"], meta["maxzoom"] = str(header["minzoom"]), str(header["maxzoom"])
    fixed = scratch / f"{archive.name}.metadata.json"
    fixed.write_text(json.dumps(meta))
    run("pmtiles", "edit", str(archive), f"--metadata={fixed}")
    fixed.unlink()


def heights(rid: str, cfg: dict, out: Path, work: Path) -> None:
    h = cfg["heights"]
    parts = []
    for n, box in enumerate(cfg["boxes"]):
        part = work / f"{rid}-heights-{n}.pmtiles"
        if not part.exists():
            written(
                part,
                lambda tmp, box=box: run(
                    "python3",
                    str(TOPO / "build_region_dem.py"),
                    "heights",
                    bbox_arg(box),
                    *["--zmax", str(h["zmax"]), "--zmin", str(h["zmin"])],
                    *["--jobs", "3", "--credit", h["credit"], "--name", h["name"]],
                    str(tmp),
                ),
            )
        parts.append(part)
    merged(parts, out / h["path"])


def slope(rid: str, cfg: dict, out: Path, work: Path) -> None:
    written(
        out / cfg["slope"]["path"],
        lambda tmp: run(
            "python3",
            str(TOPO / "build_nsw_dem.py"),
            "slope",
            str(out / cfg["heights"]["path"]),
            str(tmp),
            *["--work", str(work / f"{rid}-slope"), "--jobs", "3"],
        ),
    )


def contours(rid: str, cfg: dict, out: Path, work: Path) -> None:
    written(
        out / cfg["contours"]["path"],
        lambda tmp: run(
            "python3",
            str(TOPO / "build_nsw_dem.py"),
            "contours-archive",
            str(out / cfg["heights"]["path"]),
            str(work / f"{rid}-contours"),
            str(tmp),
        ),
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
    region = work / f"{rid}-vector.geojson"
    region_geojson([grown(b, v["margin"]) for b in cfg["boxes"]], region)
    written(
        out / v["path"],
        lambda tmp: retrying(
            "pmtiles extract",
            lambda: run(
                "pmtiles",
                "extract",
                PROTOMAPS.format(build),
                str(tmp),
                f"--region={region}",
                f"--maxzoom={v['maxzoom']}",
                capture_stderr=True,
            ),
        ),
    )


def places(rid: str, cfg: dict, out: Path, work: Path, force: bool = False) -> None:
    """OpenStreetMap inside each box, as an .osm file for the place registry
    (OVERPASS is a GET of one box), and a registry built from it as a check
    that it reads. An .osm file already there is kept unless `force`, so one
    placed by hand is used. One file a box: joining two would put one box's nodes after
    the other's ways, and the registry builder needs nodes first."""
    for n, box in enumerate(cfg["boxes"]):
        name = f"{rid}-{n}"
        osm = out / "places" / f"{name}.osm"
        if force or not osm.exists():
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


def fixtures(rid: str, cfg: dict, out: Path, work: Path, dest: Path) -> None:
    """A tile of each archive at each zoom it names, over one small box, with the
    metadata made to say what the cut holds. Cut and fitted under `work`, and
    moved into `dest` whole."""
    f = cfg["fixture"]
    for kind in ("heights", "slope", "contours", "vector"):
        if kind not in cfg:
            continue
        name = Path(cfg[kind]["path"]).name
        cut = work / "fixtures" / name
        lo, hi = cfg[kind]["fixtureZooms"]
        written(
            cut,
            lambda tmp, kind=kind, lo=lo, hi=hi: run(
                "pmtiles",
                "extract",
                str(out / cfg[kind]["path"]),
                str(tmp),
                bbox_arg(f["bbox"]),
                f"--minzoom={lo}",
                f"--maxzoom={hi}",
            ),
        )
        fit_metadata(cut, work / "fixtures")
        written(dest / name, lambda tmp, cut=cut: shutil.copy(cut, tmp))


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
            elif step == "places":
                places(rid, cfg, out, work, args.force)
            else:
                globals()[step](rid, cfg, out, work)
        for kind in ("heights", "slope", "contours", "vector"):
            if kind in cfg and (out / cfg[kind]["path"]).exists():
                fit_metadata(out / cfg[kind]["path"], work)
        if args.fixtures:
            dest = Path("/fixtures")
            dest.mkdir(parents=True, exist_ok=True)
            fixtures(rid, cfg, out, work, dest)


if __name__ == "__main__":
    main()
