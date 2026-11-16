"""Unit tests for build_region_dem.py: Mapterhorn's 512 px WebP tiles cut into
ADR 0030's 256 px PNG tiles one zoom deeper.

Every height here is made up. build_region_dem.py imports sharpen.py, which
imports osgeo, so it is stubbed first (the topo/tests/_native_stub.py
convention).
"""

import argparse
import http.client
import io
import multiprocessing
import os
import pickle
import signal
import sys
import tempfile
import unittest
import time
import urllib.error
import weakref
import gc
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from unittest import mock
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import _native_stub  # noqa: F401,E402

import build_nsw_dem as dem  # noqa: E402
import build_region_dem as region  # noqa: E402
import sharpen  # noqa: E402


MADE_UP_SOURCE = {"format": "webp", "name": "x", "minzoom": "0", "maxzoom": "6"}


def webp(heights: np.ndarray, alpha=None) -> bytes:
    """What Mapterhorn publishes: terrarium, lossless WebP, 512 px."""
    rgb = dem.encode_terrarium(heights, ~np.isnan(heights), 1 / 32)
    mode, pixels = "RGB", rgb
    if alpha is not None:
        mode, pixels = "RGBA", np.dstack([rgb, alpha])
    out = io.BytesIO()
    Image.fromarray(pixels, mode).save(out, "WEBP", lossless=True)
    return out.getvalue()


def png_heights(png: bytes) -> np.ndarray:
    return dem.decode_terrarium(np.asarray(Image.open(io.BytesIO(png)).convert("RGB")))


def ramp(size: int, top: float = 700.0) -> np.ndarray:
    """A tilted plane, in steps Mapterhorn's z16 can hold (1/32 m)."""
    y, x = np.mgrid[0:size, 0:size]
    return (np.round((top + x * 0.21 + y * 0.43) * 32) / 32).astype(np.float32)


class TestDecodeSource(unittest.TestCase):
    """Mutations that turn it red: the alpha channel ignored (a transparent
    pixel becomes a height); the no-data test dropped (a -32768 m pixel is
    drawn); no-data widened to 0 m (sea, which Mapterhorn writes as exactly
    0 m, is lost); the red and blue channels swapped on decode (every height
    wrong); the size check removed (a 256 px tile is read as if it were one
    of Mapterhorn's)."""

    def test_a_webp_decodes_to_the_heights_it_encoded(self):
        heights = ramp(512)
        np.testing.assert_array_equal(region.decode_source(webp(heights)), heights)

    def test_a_transparent_pixel_is_no_height(self):
        alpha = np.full((512, 512), 255, np.uint8)
        alpha[10, 20] = 0
        got = region.decode_source(webp(ramp(512), alpha))
        self.assertTrue(np.isnan(got[10, 20]))
        self.assertEqual(int(np.isnan(got).sum()), 1)

    def test_the_terrarium_zero_is_no_height(self):
        heights = ramp(512)
        heights[3, 4] = np.nan
        got = region.decode_source(webp(heights))
        self.assertTrue(np.isnan(got[3, 4]))

    def test_sea_is_a_height(self):
        got = region.decode_source(webp(np.zeros((512, 512), np.float32)))
        self.assertEqual(int(np.isnan(got).sum()), 0)
        self.assertEqual(float(got[0, 0]), 0.0)

    def test_a_tile_of_another_size_is_refused(self):
        out = io.BytesIO()
        Image.fromarray(np.zeros((256, 256, 3), np.uint8)).save(out, "WEBP")
        with self.assertRaises(ValueError):
            region.decode_source(out.getvalue())


class TestQuarters(unittest.TestCase):
    """Mutations that turn it red: the east and south quarters swapped; a
    child one zoom too deep or too shallow; the quarters not tiling the
    source (an offset dropped)."""

    def test_each_child_is_its_quarter_of_the_source(self):
        grid = np.zeros((512, 512), np.float32)
        grid[:256, :256], grid[:256, 256:] = 1, 2  # north-west, north-east
        grid[256:, :256], grid[256:, 256:] = 3, 4  # south-west, south-east
        got = {(z, x, y): g for z, x, y, g in region.quarters(16, 5, 7, grid)}
        self.assertEqual(
            {k: float(v.mean()) for k, v in got.items()},
            {(17, 10, 14): 1, (17, 11, 14): 2, (17, 10, 15): 3, (17, 11, 15): 4},
        )
        self.assertTrue(all(g.shape == (256, 256) for g in got.values()))

    def test_the_quarters_put_back_are_the_source(self):
        grid = ramp(512)
        out = np.zeros_like(grid)
        for _, x, y, q in region.quarters(3, 0, 0, grid):
            out[y * 256 : (y + 1) * 256, x * 256 : (x + 1) * 256] = q
        np.testing.assert_array_equal(out, grid)


class TestRounding(unittest.TestCase):
    """Mutation that turns it red: one step at every zoom (terraces in the
    hillshade on 1 m pixels, ADR 0030's update of 2026-10-23)."""

    def test_a_quarter_metre_to_z15_then_halved_each_zoom_deeper(self):
        steps = {z: region.rounding_for(z).rounding for z in (8, 13, 15, 16, 17)}
        self.assertEqual(steps, {8: 0.25, 13: 0.25, 15: 0.25, 16: 0.125, 17: 0.0625})

    def test_a_height_is_rounded_to_its_own_zoom(self):
        tile = np.full((256, 256), 100.05, np.float32)
        for z, expected in ((17, 100.0625), (16, 100.0), (15, 100.0)):
            png = next(dem.tiles_of(tile, z, 0, 0, region.rounding_for(z)))[3]
            self.assertEqual(float(png_heights(png)[0, 0]), expected)


class TestTiles(unittest.TestCase):
    """Mutations that turn it red: a box edge not reaching its tile (the south
    edge read as the north); a box edge reaching one tile too far (the tile
    range one past the east edge); the block of a source tile computed from the
    wrong zoom (a tile lands in a block it is not in); a file of Mapterhorn's
    list chosen for a zoom it does not hold, or for a box it does not touch."""

    def test_the_source_tiles_of_a_box(self):
        # z2 is four by four tiles of 90 degrees of longitude.
        box = (-10.0, -10.0, 100.0, 10.0)
        self.assertEqual(
            sorted(region.source_tiles(box, 2)),
            [(x, y) for x in (1, 2, 3) for y in (1, 2)],
        )

    def test_a_box_inside_one_tile_is_one_tile(self):
        self.assertEqual(region.source_tiles((10, 10, 11, 11), 4), [(8, 7)])

    def test_every_source_tile_is_in_the_block_that_holds_it(self):
        # zmax 17 reads z16; a block at z14 is 4 source tiles across.
        tiles = [(x, y) for x in range(62, 66) for y in range(10, 14)]
        blocks = region.blocks_of(tiles, 17, 14)
        self.assertEqual(sorted(blocks), [(15, 2), (15, 3), (16, 2), (16, 3)])
        self.assertEqual(sum(len(v) for v in blocks.values()), len(tiles))
        for (bx, by), group in blocks.items():
            for x, y in group:
                self.assertEqual((x // 4, y // 4), (bx, by))

    def test_a_file_is_chosen_by_zoom_and_by_box(self):
        def item(name, lon, lat, zoom):
            return {
                "url": name,
                "min_lon": lon,
                "max_lon": lon + 5,
                "min_lat": lat,
                "max_lat": lat + 5,
                "min_zoom": zoom[0],
                "max_zoom": zoom[1],
            }

        items = [
            item("planet", -180, -85, (0, 12)),
            item("here-16", 10, 10, (13, 16)),
            item("here-14", 10, 10, (13, 14)),
            item("far-16", 50, 50, (13, 16)),
        ]
        items[0]["max_lon"], items[0]["max_lat"] = 180, 85
        box = (11, 11, 12, 12)
        self.assertEqual(region.files_covering(items, box, 16), ["here-16"])
        self.assertEqual(region.files_covering(items, box, 14), ["here-16", "here-14"])
        self.assertEqual(region.files_covering(items, box, 12), ["planet"])
        self.assertEqual(region.files_covering(items, box, 17), [])


class TestCoarse(unittest.TestCase):
    """Mutations that turn it red: a sibling that is missing counted as 0 m
    (a tile at the box's edge drops to sea level); the parent taken from every
    other pixel of its children instead of their mean."""

    def test_a_parent_is_the_mean_of_its_children_and_no_height_where_none(self):
        striped = np.full((256, 256), 100.0, np.float32)
        striped[:, 1::2] = 200.0  # its mean over each 2 x 2 is 150
        level = {
            (0, 0): striped,
            (1, 0): np.full((256, 256), 200.0, np.float32),
        }
        (z, x, y, png), *rest = list(
            dem.coarse_levels(level, 1, 0, region.rounding_for)
        )
        self.assertEqual((z, x, y, rest), (0, 0, 0, []))
        got = png_heights(png)
        self.assertTrue((got[:128, :128] == 150).all())
        self.assertTrue((got[:128, 128:] == 200).all())
        self.assertTrue(np.isnan(got[128:]).all())


ROOT = Path(__file__).resolve().parents[2]


class TestMapterhornIsOnlyTheBuildsToRead(unittest.TestCase):
    """Guards for the rules of ADR 0052 that a test can hold: no client or
    API code names Mapterhorn's hosts (so nothing reads them at run time), and
    the build's requests carry no project or person. No check holds "the build
    never runs from CI": review does. Mutations that turn it red: a
    `https://tiles.mapterhorn.com/...` URL in any file under shared/src,
    frontend/src, mobile/src or api/src; `USER_AGENT` set to a string naming
    the project, or carrying an address, or any other change to its text."""

    SUFFIXES = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}
    DIRS = ("shared/src", "frontend/src", "mobile/src", "api/src")

    def test_no_client_or_api_file_names_mapterhorn(self):
        found = {d: 0 for d in self.DIRS}
        named = []
        for d in self.DIRS:
            for path in (ROOT / d).rglob("*"):
                if path.suffix in self.SUFFIXES and path.is_file():
                    found[d] += 1
                    if "mapterhorn.com" in path.read_text(errors="ignore").lower():
                        named.append(str(path.relative_to(ROOT)))
        # A floor: a moved directory or a changed suffix must not pass this
        # by scanning nothing.
        for d, n in found.items():
            self.assertGreater(n, 50, f"{d}: only {n} source files scanned")
        self.assertEqual(
            named,
            [],
            "ADR 0052: a region's heights are a Logjam archive; nothing reads"
            " Mapterhorn at run time",
        )

    def test_the_user_agent_names_no_project_or_person(self):
        # Pinned: a change to the client name is a decision to make here.
        self.assertEqual(region.USER_AGENT, "pmtiles-python-client")
        for word in ("logjam", "@", "http", "mailto"):
            self.assertNotIn(word, region.USER_AGENT.lower())


class FakeResponse:
    def __init__(self, body: bytes, status: int = 206):
        self.body, self.status = body, status

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self):
        if isinstance(self.body, Exception):
            raise self.body
        return self.body


def scripted(*replies):
    """An opener that gives each call the next reply: a response, or an
    exception to raise. Returns the opener and the list of its calls."""
    calls, queue = [], list(replies)

    def opener(request, timeout):
        calls.append(request)
        reply = queue.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply

    return opener, calls


def http_error(code: int, retry_after: str = ""):
    headers = {"Retry-After": retry_after} if retry_after else {}
    return urllib.error.HTTPError("https://x/f", code, "m", headers, None)


class TestFetchRange(unittest.TestCase):
    """Mutations that turn it red: `HTTPException` dropped from the retried
    errors (a short read with a Content-Length kills the worker); a 429 waited
    out for a fixed second instead of Retry-After; a Retry-After with no cap; a
    Retry-After that is not a number waited out for nothing; the wait between
    retries growing past a minute (the cap raised to 600 s); a 404 retried; a
    200 (a whole file) accepted; a short body returned; the retries never
    giving up; the range asked for ending one byte past the length; the cache
    raised above 128 ranges; a final failure raised as the
    `urllib.error.HTTPError` itself, or as any exception that cannot be
    pickled, so a pool worker's failure hangs the run."""

    def fetch(self, *replies, length=4):
        opener, calls = scripted(*replies)
        waits = []
        got = region.fetch_range(
            "https://x/f", 10, length, opener=opener, sleep=waits.append
        )
        return got, calls, waits

    def test_the_range_asked_for_is_the_range_read(self):
        got, calls, waits = self.fetch(FakeResponse(b"abcd"))
        self.assertEqual((got, waits), (b"abcd", []))
        self.assertEqual(calls[0].get_header("Range"), "bytes=10-13")
        self.assertEqual(calls[0].get_header("User-agent"), region.USER_AGENT)

    def test_a_dropped_reply_is_read_again(self):
        got, _, waits = self.fetch(
            FakeResponse(http.client.IncompleteRead(b"ab", 2)),
            ConnectionResetError(),
            FakeResponse(b"ab"),  # short
            FakeResponse(b"abcd"),
        )
        self.assertEqual(got, b"abcd")
        self.assertEqual(waits, [1, 2, 4])

    def test_a_429_waits_as_long_as_retry_after_says(self):
        got, _, waits = self.fetch(http_error(429, "30"), FakeResponse(b"abcd"))
        self.assertEqual((got, waits), (b"abcd", [30]))

    def test_a_503_waits_as_long_as_retry_after_says_up_to_a_cap(self):
        _, _, waits = self.fetch(http_error(503, "99999"), FakeResponse(b"abcd"))
        self.assertEqual(waits, [region.MAX_RETRY_AFTER_S])

    def test_a_429_with_no_usable_retry_after_backs_off(self):
        _, _, waits = self.fetch(
            http_error(429), http_error(429, "soon"), FakeResponse(b"abcd")
        )
        self.assertEqual(waits, [1, 2])

    def test_a_5xx_is_retried_and_the_wait_stops_growing_at_a_minute(self):
        replies = [http_error(502)] * 7 + [FakeResponse(b"abcd")]
        _, _, waits = self.fetch(*replies)
        self.assertEqual(waits, [1, 2, 4, 8, 16, 32, 60])

    def test_another_4xx_is_not_retried(self):
        opener, calls = scripted(http_error(404), FakeResponse(b"abcd"))
        with self.assertRaises(region.NotRangeable):
            region.fetch_range(
                "https://x/f", 0, 4, opener=opener, sleep=lambda s: 1 / 0
            )
        self.assertEqual(len(calls), 1)

    def test_a_whole_file_is_refused_without_being_read(self):
        opener, calls = scripted(FakeResponse(b"x" * 100, status=200))
        with self.assertRaises(region.NotRangeable):
            region.fetch_range(
                "https://x/f", 0, 4, opener=opener, sleep=lambda s: 1 / 0
            )
        self.assertEqual(len(calls), 1)

    def test_it_gives_up_after_its_attempts(self):
        opener, calls = scripted(*[http_error(500)] * region.ATTEMPTS)
        with self.assertRaises(region.FetchError):
            region.fetch_range("https://x/f", 0, 4, opener=opener, sleep=lambda s: None)
        self.assertEqual(len(calls), region.ATTEMPTS)

    def test_every_failure_survives_pickling(self):
        # A pool worker's exception is pickled to the parent. An
        # urllib.error.HTTPError cannot be unpickled there, which hangs the
        # pool: every way a read ends must come out as something that can.
        def failure(*replies):
            opener, _ = scripted(*replies)
            with self.assertRaises(Exception) as caught:
                region.fetch_range(
                    "https://x/f", 0, 4, opener=opener, sleep=lambda s: None
                )
            return caught.exception

        failures = [
            failure(*[http_error(500)] * region.ATTEMPTS),
            failure(*[http_error(429, "1")] * region.ATTEMPTS),
            failure(
                *[FakeResponse(http.client.IncompleteRead(b"a", 3))] * region.ATTEMPTS
            ),
            failure(*[FakeResponse(b"ab")] * region.ATTEMPTS),
            failure(*[ConnectionResetError()] * region.ATTEMPTS),
            failure(http_error(404)),
            failure(FakeResponse(b"x", status=200)),
        ]
        for exc in failures:
            again = pickle.loads(pickle.dumps(exc))
            self.assertEqual((type(again), str(again)), (type(exc), str(exc)))

    def test_the_reader_keeps_few_bodies(self):
        # The reader's cache is the lru_cache on get_bytes: small, because it
        # also holds each tile body, which is read once.
        with mock.patch.object(region, "fetch_range", lambda *a: b"x") as _:
            reader = region.http_reader("https://x/f")
        cache = reader.get_bytes
        self.assertLessEqual(cache.cache_parameters()["maxsize"], 128)


class BrokenSource:
    """A source whose read fails for good, as a worker sees it."""

    def get(self, z, x, y):
        raise urllib.error.HTTPError("https://x/f", 500, "m", {}, None)


class FakeSource:
    """Stands in for Mapterhorn's reader: one made-up z16 tile."""

    def __init__(self, tiles):
        self.tiles = tiles

    def get(self, z, x, y):
        return self.tiles.get((z, x, y))


class TestBlock(unittest.TestCase):
    """Mutations that turn it red: a quarter in the wrong place in the block;
    a block's zooms taken from every other pixel instead of the mean, in its
    tiles (`block_tiles`) or in the grid handed back for the coarser zooms; a
    source tile that is missing not skipped; only the first of several sources
    tried."""

    def setUp(self):
        self.addCleanup(region._readers.clear)

    def test_a_block_holds_the_heights_it_was_given_at_every_zoom(self):
        # z17 over a z14 block: z16 source tiles (8, 8) and (9, 8) are the
        # west and east halves of the top of block (2, 2)'s 8 x 8 tiles.
        west, east = ramp(512, 700.0), ramp(512, 900.0)
        region._readers[:] = [
            FakeSource({(16, 8, 8): webp(west), (16, 9, 8): webp(east)})
        ]
        rows, (bx, by, grid) = region.build_block(
            (17, 14, 2, 2, [(8, 8), (9, 8), (8, 9)])  # (8, 9) has no tile
        )
        by_tile = {(z, x, y): png for z, x, y, png in rows}

        # z17: the north-west quarter of the west tile is tile (16, 16).
        got = png_heights(by_tile[(17, 16, 16)])
        expected = np.round(west[:256, :256] * 16) / 16
        np.testing.assert_array_equal(got, expected)
        # And the east tile's south-east quarter is (19, 17).
        got = png_heights(by_tile[(17, 19, 17)])
        np.testing.assert_array_equal(got, np.round(east[256:, 256:] * 16) / 16)

        # z16: the mean of the four heights below each pixel, rounded to 1/8 m.
        mean = west.reshape(256, 2, 256, 2).mean(axis=(1, 3))
        got = png_heights(by_tile[(16, 8, 8)])
        np.testing.assert_array_equal(got, np.round(mean * 8) / 8)

        # Only tiles with a height: four z17 quarters per source tile, two
        # tiles, then two z16, a z15 and the block's z14.
        self.assertEqual(
            sorted(z for z, _, _, _ in rows), [14] + [15] + [16] * 2 + [17] * 8
        )
        self.assertEqual(grid.shape, (256, 256))
        self.assertEqual((bx, by), (2, 2))
        # The grid handed back for the coarser zooms is the z14 tile's heights.
        z14 = png_heights(by_tile[(14, 2, 2)])
        self.assertEqual(grid.shape, z14.shape)
        np.testing.assert_array_equal(np.isnan(grid), np.isnan(z14))
        valid = ~np.isnan(grid)
        np.testing.assert_array_equal(z14[valid], np.round(grid[valid] * 4) / 4)

    def test_a_block_with_nothing_has_no_tiles(self):
        region._readers[:] = [FakeSource({})]
        rows, (_, _, grid) = region.build_block((17, 14, 2, 2, [(8, 8)]))
        self.assertEqual(rows, [])
        self.assertTrue(np.isnan(grid).all())

    def test_the_first_source_with_the_tile_answers(self):
        region._readers[:] = [FakeSource({}), FakeSource({(16, 1, 1): b"x"})]
        self.assertEqual(region.source_tile(16, 1, 1), b"x")
        self.assertIsNone(region.source_tile(16, 2, 2))


class TestInitFailure(unittest.TestCase):
    """A source that cannot be opened must stop the run with a sentence, not
    hang it. Mutations that turn it red: the check of every source in `heights`
    removed (a mistyped `--source` is then read in the workers); the worker
    initializer left to raise (the pool breaks with no reason given, and the
    real-pool test, which wants the reason, fails); `build_block`
    not raising the failure the initializer kept; the wrapper in `build_block`
    removed (a worker's `HTTPError` then escapes as itself, which cannot be
    unpickled in the parent and hangs a process pool)."""

    def args(self, tmp, sources, **extra):
        values = dict(
            bbox="0.5,42,1.0,43",
            zmax=7,
            zmin=5,
            credit="c",
            name="n",
            jobs=1,
            source=sources,
            out=str(Path(tmp) / "out.pmtiles"),
        )
        values.update(extra)
        return argparse.Namespace(**values)

    def test_a_missing_source_stops_the_run_with_its_name(self):
        with tempfile.TemporaryDirectory() as tmp:
            gone = str(Path(tmp) / "typo.pmtiles")
            with self.assertRaises(SystemExit) as caught:
                region.heights(self.args(tmp, [gone]))
        self.assertIn(gone, str(caught.exception))

    def test_an_empty_source_stops_the_run_with_its_name(self):
        with tempfile.TemporaryDirectory() as tmp:
            empty = Path(tmp) / "empty.pmtiles"
            empty.write_bytes(b"")
            with self.assertRaises(SystemExit) as caught:
                region.heights(self.args(tmp, [str(empty)]))
        self.assertIn(str(empty), str(caught.exception))

    def test_an_initializer_that_fails_does_not_raise_and_the_block_says_why(self):
        self.addCleanup(region._readers.clear)
        self.addCleanup(setattr, region, "_init_failure", None)
        with mock.patch.object(region, "open_source", side_effect=OSError("no file")):
            region.init_worker(["x"])
        with self.assertRaises(RuntimeError) as caught:
            region.build_block((17, 14, 2, 3, [(8, 8)]))
        self.assertIn("no file", str(caught.exception))

    def test_a_block_that_fails_raises_what_can_be_pickled(self):
        region._readers[:] = [BrokenSource()]
        self.addCleanup(region._readers.clear)
        with self.assertRaises(RuntimeError) as caught:
            region.build_block((17, 14, 2, 3, [(8, 8)]))
        again = pickle.loads(pickle.dumps(caught.exception))
        self.assertIn("block 2, 3", str(again))
        self.assertIn("HTTPError", str(again))

    def test_a_pool_whose_workers_cannot_open_a_source_ends_with_the_reason(self):
        # The parent can open the source and the workers cannot: the second
        # call, in each (forked) worker, fails.
        calls = []

        def flaky(source):
            calls.append(source)
            if len(calls) > 1:
                raise OSError("worker cannot open it")
            return mock.Mock()

        def alarm(*_):
            raise AssertionError("the run hung")

        old = signal.signal(signal.SIGALRM, alarm)
        signal.alarm(60)
        try:
            with (
                tempfile.TemporaryDirectory() as tmp,
                mock.patch.object(region, "open_source", flaky),
                mock.patch.object(
                    region, "POOL_CONTEXT", multiprocessing.get_context("fork")
                ),
            ):
                with self.assertRaises(RuntimeError) as caught:
                    region.heights(self.args(tmp, ["made-up"]))
        finally:
            signal.alarm(0)
            signal.signal(signal.SIGALRM, old)
        self.assertIn("worker cannot open it", str(caught.exception))


class ManyBlocks(unittest.TestCase):
    """Helpers for a run over a box of several blocks, on threads (a process
    pool pickles results, so a reference to one could not be watched)."""

    def run_heights(self, tmp, build_block, write_pmtiles, jobs=1):
        src = Path(tmp) / "made-up.pmtiles"
        sharpen.write_pmtiles([(6, 32, 23, webp(ramp(512)))], src, MADE_UP_SOURCE)
        # A box of 5 blocks at z7 (about 2.8 degrees wide each).
        args = argparse.Namespace(
            bbox="0.5,42,12,43",
            zmax=10,
            zmin=6,
            credit="c",
            name="n",
            jobs=jobs,
            source=[str(src)],
            out=str(Path(tmp) / "out.pmtiles"),
        )

        def threads(jobs, mp_context, initializer, initargs):
            return ThreadPoolExecutor(jobs, initializer=initializer, initargs=initargs)

        with (
            mock.patch.object(region, "build_block", build_block),
            mock.patch.object(region, "ProcessPoolExecutor", threads),
            mock.patch.object(sharpen, "write_pmtiles", write_pmtiles),
        ):
            region.heights(args)


class Rows(list):
    """A block's rows: a list that can be watched with a weak reference."""


class TestMemory(ManyBlocks):
    """A finished block's rows must be let go once they are written, so a run
    holds a few blocks and not the whole archive. Mutation that turns it red:
    the list of futures in `heights` kept under a name (each future holds its
    block's rows until the run ends)."""

    def test_a_written_block_is_released_before_the_next_is_written(self):
        refs = {}

        def build_block(job):
            rows = Rows([(job[2], 0, 0, b"png")])
            refs[job[2]] = weakref.ref(rows)
            return rows, (job[2], job[3], np.full((256, 256), np.nan, np.float32))

        seen = {}

        def write_pmtiles(stream, out, meta):
            first = None
            for z, *_ in stream:
                if first is None:
                    first = z
                elif z != first and first not in seen:
                    gc.collect()
                    seen[first] = refs[first]() is None
            Path(out).write_bytes(b"")

        with tempfile.TemporaryDirectory() as tmp:
            self.run_heights(tmp, build_block, write_pmtiles)
        self.assertGreaterEqual(len(refs), 3)
        self.assertTrue(seen, "no second block was written")
        self.assertTrue(all(seen.values()), seen)


class TestWriterFails(ManyBlocks):
    """A writer that fails (a full disk) must stop the queued blocks, not leave
    them to run, network reads and all, after the failure. Mutation that turns
    it red: `contextlib.closing` removed from `heights` (the failed run's
    generator stays open, and its queue is run to the end)."""

    def test_blocks_not_yet_started_never_start(self):
        started = []

        def build_block(job):
            started.append(job[2])
            time.sleep(0.05)
            return Rows([(job[2], 0, 0, b"png")]), (
                job[2],
                job[3],
                np.full((256, 256), np.nan, np.float32),
            )

        def write_pmtiles(stream, out, meta):
            next(iter(stream))
            raise OSError("no space left on device")

        with tempfile.TemporaryDirectory() as tmp:
            try:
                self.run_heights(tmp, build_block, write_pmtiles)
            except OSError as error:
                # Kept, with its traceback: that is what keeps a generator
                # left open alive after the failure.
                failure = error
            time.sleep(0.8)  # long enough for the whole queue to have run
        self.assertIn("no space", str(failure))
        # Blocks already running when it failed still finish.
        self.assertLessEqual(len(started), 3, started)


class TestWorkerKilled(unittest.TestCase):
    """A worker that dies part-way (out of memory) must fail the run, not leave
    it waiting for a block that never arrives. Mutation that turns it red:
    `multiprocessing.Pool` with `imap_unordered` in place of
    `ProcessPoolExecutor` in `heights` (the run waits for ever: the test ends
    in its alarm)."""

    def test_a_killed_worker_raises_instead_of_hanging(self):
        def alarm(*_):
            raise AssertionError("the run hung")

        old = signal.signal(signal.SIGALRM, alarm)
        signal.alarm(60)
        try:
            with tempfile.TemporaryDirectory() as tmp:
                src = Path(tmp) / "made-up.pmtiles"
                sx, sy = dem.lonlat_to_tile(0.75, 42.5, 6)
                sharpen.write_pmtiles(
                    [(6, sx, sy, webp(ramp(512)))], src, MADE_UP_SOURCE
                )
                args = argparse.Namespace(
                    bbox="0.5,42,1.0,43",
                    zmax=7,
                    zmin=5,
                    credit="c",
                    name="n",
                    jobs=2,
                    source=[str(src)],
                    out=str(Path(tmp) / "out.pmtiles"),
                )
                with (
                    mock.patch.object(region, "_build_block", lambda job: os._exit(1)),
                    mock.patch.object(
                        region, "POOL_CONTEXT", multiprocessing.get_context("fork")
                    ),
                ):
                    with self.assertRaises(BrokenProcessPool):
                        region.heights(args)
        finally:
            signal.alarm(0)
            signal.signal(signal.SIGALRM, old)


class TestCommandLine(unittest.TestCase):
    """Mutation that turns it red: `--bbox` renamed, or its value split into
    several arguments. A west edge below zero has to be passed as
    `--bbox=-112.2,…`: on Python 3.12 (the worker image's) argparse refuses
    `--bbox -112.2,…` ("expected one argument"), and 3.14 accepts it."""

    def test_a_negative_west_edge_reaches_heights_whole(self):
        argv = [
            "build_region_dem.py",
            "heights",
            "--bbox=-112.2,40.5,-111.6,41",
            "--zmax",
            "15",
            "--credit",
            "c",
            "out.pmtiles",
        ]
        with (
            mock.patch.object(sys, "argv", argv),
            mock.patch.object(region, "heights") as run,
        ):
            region.main()
        (args,), _ = run.call_args
        self.assertEqual(args.bbox, "-112.2,40.5,-111.6,41")
        self.assertEqual(args.zmax, 15)


class TestBuild(unittest.TestCase):
    """A whole run over a made-up archive of one z6 tile (a source, as
    Mapterhorn's files are), written to a real PMTiles and read back.
    Mutations that turn it red: `--zmin` ignored; bounds left out (a reader
    then takes the archive for the world); the credit not the archive's
    attribution; the check that a box has no tiles removed (the run then
    fails with something else than a sentence)."""

    def test_an_archive_comes_out_in_adr_0030_form(self):
        from pmtiles.reader import MmapSource, Reader

        heights = ramp(512)
        sx, sy = dem.lonlat_to_tile(0.75, 42.5, 6)
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "made-up.pmtiles"
            sharpen.write_pmtiles([(6, sx, sy, webp(heights))], src, MADE_UP_SOURCE)
            out = Path(tmp) / "out.pmtiles"
            region.heights(
                argparse.Namespace(
                    bbox="0.5,42,1.0,43",
                    zmax=7,
                    zmin=5,
                    credit="Made up. Public domain.",
                    name="Made up",
                    jobs=1,
                    source=[str(src)],
                    out=str(out),
                )
            )
            with open(out, "rb") as fh:
                reader = Reader(MmapSource(fh))
                header, meta = reader.header(), reader.metadata()
                self.assertEqual((header["min_zoom"], header["max_zoom"]), (5, 7))
                self.assertEqual(meta["attribution"], "Made up. Public domain.")
                self.assertEqual(meta["encoding"], "terrarium")
                west, south, east, north = (float(v) for v in meta["bounds"].split(","))
                self.assertLess(west, 0.5)
                self.assertGreater(east, 1.0)
                self.assertLess(south, 42)
                self.assertGreater(north, 43)
                self.assertLess(east - west, 6)
                # z7 is the four quarters of the z6 tile, as the heights were given.
                tile = png_heights(reader.get(7, 2 * sx, 2 * sy))
                np.testing.assert_array_equal(
                    tile, np.round(heights[:256, :256] * 4) / 4
                )
                # z5 is there, and z7 has no tile off the source.
                self.assertIsNotNone(reader.get(5, sx // 2, sy // 2))
                self.assertIsNone(reader.get(7, 0, 0))

    def test_a_box_with_no_tiles_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "empty.pmtiles"
            sharpen.write_pmtiles([(6, 0, 0, webp(ramp(512)))], src, MADE_UP_SOURCE)
            args = argparse.Namespace(
                bbox="0.5,42,1.0,43",
                zmax=7,
                zmin=5,
                credit="c",
                name="n",
                jobs=1,
                source=[str(src)],
                out=str(Path(tmp) / "out.pmtiles"),
            )
            with self.assertRaises(SystemExit):
                region.heights(args)


if __name__ == "__main__":
    unittest.main()
