#!/usr/bin/env python3
"""
build_region_dem.py
-------------------
Cuts a region's heights out of Mapterhorn's public elevation tiles and writes
them as a Logjam DEM archive: terrarium PNG, 256 px, heights rounded as ADR
0030 says, in one PMTiles file. A tile Mapterhorn publishes is 512 px
terrarium WebP; each one becomes four 256 px PNG tiles one zoom deeper, so the
pixels line up and nothing is resampled.
docs/decisions/0052-a-new-regions-heights-are-a-mapterhorn-extract-transcoded-to-adr-0030-tiles.md

    build_region_dem.py heights --bbox W,S,E,N --zmax 17 --credit "…" OUT.pmtiles
    build_region_dem.py heights --bbox=-112.2,40.5,-111.6,41 …   # a negative W: write "="
                                [--zmin 8] [--name NAME] [--jobs N] [--source URL ...]

`--zmax` is the deepest zoom written. It needs Mapterhorn tiles one zoom up
(zoom 17 reads Mapterhorn's zoom 16). Every coarser zoom down to `--zmin` is
the mean of the heights below, taken before encoding, as in the NSW archive
(`pack` in build_nsw_dem.py).

Mapterhorn is read by byte range from its download host, the traffic
`pmtiles extract` makes, and only the tiles over the box are fetched. Without
`--source` the files that cover the box at that zoom come from its
`download_urls.json`; a `--source` (a URL or a path to a PMTiles file, given
as often as needed, tried in order) replaces that.

Where Mapterhorn has no tile, the archive has none. A pixel it marks as no
height (a transparent pixel, or the terrarium value for -32768 m) is written as
ADR 0030's no-data. Sea in the tiles read was exactly 0 m, and stays a height.
"""

import argparse
import contextlib
import dataclasses
import functools
import http.client
import io
import json
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from typing import Dict, Iterator, List, Optional, Tuple

import numpy as np
from PIL import Image

import build_nsw_dem as dem
import sharpen

DOWNLOAD_URLS = "https://download.mapterhorn.com/download_urls.json"
# Not the project's name: this goes to somebody else's server. Guard:
# tests/test_region_dem.py `TestMapterhornIsOnlyTheBuildsToRead`.
USER_AGENT = "pmtiles-python-client"
SOURCE_TILE = 512  # Mapterhorn's tile size, in pixels
ATTEMPTS = 8  # a range read, waiting 1, 2, 4 ... 60 s between
MAX_WAIT_S = 60
MAX_RETRY_AFTER_S = 300
POOL_CONTEXT = None  # the default start method; a test sets one
BLOCK_LEVELS = 3  # a block is 2**3 tiles across at the deepest zoom


# ── Pure pieces (topo/tests/test_region_dem.py) ──────────────────────────────


def decode_source(data: bytes) -> np.ndarray:
    """A Mapterhorn tile as heights in metres, NaN where it has none."""
    image = Image.open(io.BytesIO(data))
    if image.size != (SOURCE_TILE, SOURCE_TILE):
        raise ValueError(f"expected a {SOURCE_TILE} px tile, got {image.size}")
    pixels = np.asarray(image.convert("RGBA"))
    heights = dem.decode_terrarium(pixels[..., :3])
    heights[pixels[..., 3] == 0] = np.nan
    return heights


def quarters(z: int, x: int, y: int, grid: np.ndarray) -> Iterator[tuple]:
    """(z, x, y, 256 px grid) of the four tiles one zoom deeper that a
    512 px tile at (z, x, y) is made of."""
    t = dem.TILE
    for dy in (0, 1):
        for dx in (0, 1):
            yield (
                z + 1,
                2 * x + dx,
                2 * y + dy,
                grid[dy * t : (dy + 1) * t, dx * t : (dx + 1) * t],
            )


def rounding_for(z: int) -> dem.Layer:
    """ADR 0030's heights at zoom `z`: a quarter metre to z15, then halved each
    zoom deeper (what a sharpened area's archive has;
    tests/test_region_dem.py `TestRounding`). PNG level 9, as the NSW archive:
    this is a one-off build and the smaller file is what is hosted."""
    layer = sharpen.rounding_at(sharpen.HEIGHTS, max(z, sharpen.ZMIN))
    return dataclasses.replace(layer, png_level=dem.HEIGHTS.png_level)


def source_tiles(
    bbox: Tuple[float, float, float, float], z: int
) -> List[Tuple[int, int]]:
    """Every tile at zoom `z` that a (west, south, east, north) box touches."""
    west, south, east, north = bbox
    x0, y0 = dem.lonlat_to_tile(west, north, z)
    x1, y1 = dem.lonlat_to_tile(east, south, z)
    return [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]


def blocks_of(tiles: List[Tuple[int, int]], zmax: int, zb: int) -> Dict[tuple, list]:
    """Source tiles (at zmax - 1) grouped by the block, at zoom `zb`, they
    fall in. A source tile is two tiles wide at zmax, so it is whole in one."""
    shift = zmax - 1 - zb
    blocks: Dict[tuple, list] = {}
    for x, y in tiles:
        blocks.setdefault((x >> shift, y >> shift), []).append((x, y))
    return blocks


def block_tiles(grid: np.ndarray, zmax: int, zb: int, bx: int, by: int):
    """(z, x, y, png) of every tile with a height, from zmax up to zb, for the
    block at zoom `zb` whose heights at zmax are `grid`. The last grid, at zb,
    is what the coarser zooms are made from."""
    for z in range(zmax, zb - 1, -1):
        scale = 2 ** (z - zb)
        yield from dem.tiles_of(grid, z, bx * scale, by * scale, rounding_for(z))
        if z > zb:
            grid = dem.halve(grid)


# ── Reading Mapterhorn ───────────────────────────────────────────────────────


class FetchError(OSError):
    """A range read that failed for good. A plain message and nothing else, so
    it survives the pickling that carries a worker's exception to the parent:
    `urllib.error.HTTPError` does not, and the pool then waits for ever
    (tests/test_region_dem.py `TestFetchRange.test_every_failure_survives_pickling`)."""


class NotRangeable(Exception):
    """The server answered a range request with something else (a whole file,
    or an error that asking again will not change)."""


def fetch_range(
    url: str,
    offset: int,
    length: int,
    opener=urllib.request.urlopen,
    sleep=time.sleep,
) -> bytes:
    """Exactly `length` bytes at `offset`, or an exception.

    Retried with a growing wait (to a minute) on a dropped or short reply, a
    5xx and a 429 or 503, which wait as long as `Retry-After` says. Any other
    4xx, and a reply that is not 206, is raised at once: asking again changes
    nothing, and a 200 would be a whole file read into memory
    (tests/test_region_dem.py `TestFetchRange`).
    """
    request = urllib.request.Request(
        url,
        headers={
            "Range": f"bytes={offset}-{offset + length - 1}",
            "User-Agent": USER_AGENT,
        },
    )
    for attempt in range(ATTEMPTS):
        wait = min(2**attempt, MAX_WAIT_S)
        try:
            with opener(request, timeout=60) as response:
                if response.status != 206:
                    raise NotRangeable(f"{url}: {response.status}, not 206")
                data = response.read()
            if len(data) == length:
                return data
            error: Exception = OSError(f"short read: {len(data)} of {length}")
        except urllib.error.HTTPError as e:
            if e.code in (429, 503):
                retry_after = (e.headers or {}).get("Retry-After", "")
                if retry_after.isdigit():
                    wait = min(int(retry_after), MAX_RETRY_AFTER_S)
            elif e.code < 500:
                raise NotRangeable(f"{url}: {e.code}") from e
            error = e
        except (OSError, http.client.HTTPException) as e:
            error = e
        if attempt == ATTEMPTS - 1:
            if isinstance(error, urllib.error.HTTPError):
                raise FetchError(f"{url}: HTTP {error.code}") from error
            raise FetchError(f"{url}: {type(error).__name__}: {error}") from error
        sleep(wait)
    raise AssertionError("unreachable")


def http_reader(url: str):
    """A PMTiles reader of a file served over HTTP, by byte range."""
    from pmtiles.reader import Reader

    # The reader asks for the header and the directories on every tile, so
    # they are worth keeping. The cache is small because it also gets every
    # tile body, which is read exactly once: a large one would hold hundreds
    # of megabytes per worker for nothing (tests/test_region_dem.py
    # `TestFetchRange.test_the_reader_keeps_few_bodies`).
    @functools.lru_cache(maxsize=128)
    def get_bytes(offset: int, length: int) -> bytes:
        return fetch_range(url, offset, length)

    return Reader(get_bytes)


def open_source(src: str):
    if src.startswith(("http://", "https://")):
        return http_reader(src)
    return sharpen.open_archive(src)


def files_covering(items: List[dict], bbox, z: int) -> List[str]:
    """The URLs of the files in Mapterhorn's list that hold zoom `z` over the box."""
    west, south, east, north = bbox
    return [
        item["url"]
        for item in items
        if item["min_zoom"] <= z <= item["max_zoom"]
        and item["min_lon"] < east
        and item["max_lon"] > west
        and item["min_lat"] < north
        and item["max_lat"] > south
    ]


def mapterhorn_files(bbox, z: int) -> List[str]:
    request = urllib.request.Request(DOWNLOAD_URLS, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        return files_covering(json.load(response)["items"], bbox, z)


_readers: list = []  # this process's readers, in the order they are tried
_init_failure: Optional[str] = None  # why this process could not open them


def init_worker(sources: List[str]) -> None:
    """Open this process's readers. It never raises: a pool whose initializer
    fails is broken with no reason given, so the failure is kept and
    `build_block` raises it
    (tests/test_region_dem.py `TestInitFailure`)."""
    global _init_failure
    _readers.clear()
    _init_failure = None
    try:
        _readers.extend(open_source(s) for s in sources)
    except Exception as e:
        _init_failure = f"{type(e).__name__}: {e}"


def source_tile(z: int, x: int, y: int) -> Optional[bytes]:
    for reader in _readers:
        data = reader.get(z, x, y)
        if data is not None:
            return data
    return None


def build_block(job: Tuple[int, int, int, int, list]):
    """One block: its tiles as (z, x, y, png) rows, and its grid at zoom zb.

    Runs in a pool worker, so whatever it raises is rebuilt as a plain
    RuntimeError: an exception that cannot be unpickled in the parent leaves
    the run waiting for ever (tests/test_region_dem.py `TestInitFailure`)."""
    try:
        if _init_failure:
            raise RuntimeError(f"cannot open the sources: {_init_failure}")
        return _build_block(job)
    except Exception as e:
        raise RuntimeError(
            f"block {job[2]}, {job[3]}: {type(e).__name__}: {e}"
        ) from None


def _build_block(job: Tuple[int, int, int, int, list]):
    zmax, zb, bx, by, tiles = job
    span = 2 ** (zmax - zb)
    side = span * dem.TILE
    grid = np.full((side, side), np.nan, np.float32)
    for x, y in tiles:
        data = source_tile(zmax - 1, x, y)
        if data is None:
            continue
        for _, qx, qy, quarter in quarters(zmax - 1, x, y, decode_source(data)):
            row, col = qy - by * span, qx - bx * span
            t = dem.TILE
            grid[row * t : (row + 1) * t, col * t : (col + 1) * t] = quarter
    rows = list(block_tiles(grid, zmax, zb, bx, by))
    # The grid at zb is one tile: halve to it.
    for _ in range(zmax - zb):
        grid = dem.halve(grid)
    return rows, (bx, by, grid)


def heights(args: argparse.Namespace) -> None:
    bbox = tuple(float(v) for v in args.bbox.split(","))
    if len(bbox) != 4 or bbox[0] >= bbox[2] or bbox[1] >= bbox[3]:
        sys.exit("--bbox is W,S,E,N in degrees, west of east and south of north")
    zmax, zmin = args.zmax, args.zmin
    if zmax <= zmin:
        sys.exit("--zmax must be deeper than --zmin")
    zb = max(zmin, zmax - BLOCK_LEVELS)
    sources = args.source or mapterhorn_files(bbox, zmax - 1)
    if not sources:
        sys.exit(f"Mapterhorn has no file with zoom {zmax - 1} over {args.bbox}")
    for source in sources:
        # Once, here, before any worker starts: a source that cannot be opened
        # (a mistyped path, an empty file, no boto3) stops the run with a
        # sentence, whatever kind of source it is
        # (tests/test_region_dem.py `TestInitFailure`).
        try:
            open_source(source).header()
        except Exception as e:
            sys.exit(f"cannot read {source}: {type(e).__name__}: {e}")
    tiles = source_tiles(bbox, zmax - 1)
    blocks = blocks_of(tiles, zmax, zb)
    blocks_jobs = [
        (zmax, zb, bx, by, tiles) for (bx, by), tiles in sorted(blocks.items())
    ]
    print(f"{len(blocks_jobs)} blocks from {len(sources)} sources", file=sys.stderr)

    level: Dict[Tuple[int, int], np.ndarray] = {}
    count = 0

    def rows():
        nonlocal count
        # Not multiprocessing.Pool: a worker killed part-way (out of memory)
        # leaves that waiting for ever; this raises BrokenProcessPool, as
        # build_slope in build_nsw_dem.py does
        # (tests/test_region_dem.py `TestWorkerKilled`).
        with ProcessPoolExecutor(
            args.jobs,
            mp_context=POOL_CONTEXT,
            initializer=init_worker,
            initargs=(sources,),
        ) as pool:
            try:
                # No name for the list of futures: each one holds its block's
                # rows until it is dropped, and `as_completed` drops each as it
                # yields it (tests/test_region_dem.py `TestMemory`).
                for done in as_completed(
                    [pool.submit(build_block, job) for job in blocks_jobs]
                ):
                    block_rows, (bx, by, grid) = done.result()
                    level[(bx, by)] = grid
                    count += len(block_rows)
                    yield from block_rows
            except BaseException:
                # Cancel what is queued: the `with`'s own shutdown would run
                # every queued block first (tests/test_region_dem.py
                # `TestWriterFails`).
                pool.shutdown(cancel_futures=True)
                raise
        if not count:
            sys.exit(f"Mapterhorn has no tile at zoom {zmax - 1} over {args.bbox}")
        for row in dem.coarse_levels(level, zb, zmin, rounding_for):
            count += 1
            yield row

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    # Without bounds a reader takes the archive to cover the world
    # (tests/test_region_dem.py `TestBuild`).
    west, north = dem.tile_lonlat(*tile_corner(tiles, min), zmax - 1)
    east, south = dem.tile_lonlat(*tile_corner(tiles, max, 1), zmax - 1)
    meta = {
        "bounds": f"{west},{south},{east},{north}",
        "center": f"{(west + east) / 2},{(south + north) / 2},{zmin}",
        "name": args.name,
        "format": "png",
        "type": "baselayer",
        "encoding": "terrarium",
        "minzoom": str(zmin),
        "maxzoom": str(zmax),
        "attribution": args.credit,
    }
    try:
        # Closed on a failure of the writer (a full disk), so the queued blocks
        # are cancelled then and not run after it (`TestWriterFails`).
        with contextlib.closing(rows()) as stream:
            sharpen.write_pmtiles(stream, out, meta)
    finally:
        out.with_suffix(".mbtiles").unlink(missing_ok=True)
    print(f"{count} tiles, {out.stat().st_size} bytes", file=sys.stderr)


def tile_corner(tiles, pick, plus: int = 0) -> Tuple[int, int]:
    """The (x, y) of the corner of the tiles' extent: the north-west corner
    with `min`, the south-east one with `max` and plus=1."""
    return pick(x for x, _ in tiles) + plus, pick(y for _, y in tiles) + plus


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    commands = parser.add_subparsers(dest="command", required=True)
    cmd = commands.add_parser("heights", help="Mapterhorn tiles to a Logjam archive")
    cmd.add_argument(
        "--bbox",
        required=True,
        help="W,S,E,N in degrees; write --bbox=… when W is negative",
    )
    cmd.add_argument("--zmax", type=int, required=True)
    cmd.add_argument("--zmin", type=int, default=8)
    cmd.add_argument("--credit", required=True, help="the archive's attribution")
    cmd.add_argument("--name", default="Terrain heights")
    cmd.add_argument("--jobs", type=int, default=4)
    cmd.add_argument("--source", action="append", help="a PMTiles URL or path")
    cmd.add_argument("out")
    cmd.set_defaults(run=heights)
    args = parser.parse_args()
    args.run(args)


if __name__ == "__main__":
    main()
