"""Unit tests for the pure pieces of build_nsw_dem.py: the terrarium encoding
the clients decode, the 2x2 averaging between zooms, and the block maths.

build_nsw_dem.py imports osgeo at module top, so it is stubbed first (the
topo/tests/_native_stub.py convention).
"""

import io
import json
import math
import os
import re
import sys
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import _native_stub  # noqa: F401,E402  (stubs osgeo when absent on the host)

from build_nsw_dem import (  # noqa: E402
    BLOCK_ZOOM,
    block_zoom,
    build_slope,
    centre_box,
    contour_lines,
    contours_archive,
    smoothing_factor,
    tile_range,
    EARTH_CIRCUMFERENCE_M,
    HEIGHTS,
    SLOPE,
    TILE,
    ZMAX,
    block_slope,
    blocks_for,
    credit,
    CONTOUR_KEY,
    HEIGHT_KEY,
    SLOPE_KEY,
    decode_terrarium,
    derived_credit,
    slope_s3,
    encode_terrarium,
    halve,
    halve_max,
    horn_slope,
    lonlat_to_tile,
    pixel_size_m,
    png_bytes,
    tile_bounds_3857,
    tiles_of,
)


def decode(rgb: np.ndarray) -> np.ndarray:
    """The decode in shared/src/demTiles.ts, written out again on purpose."""
    r, g, b = (rgb[..., i].astype(np.float64) for i in range(3))
    return r * 256 + g + b / 256 - 32768


class TestEncodeTerrarium(unittest.TestCase):
    # Mutation: swap R and G, or drop the +32768, and the clients read a
    # height that is wrong by hundreds of metres without any error.
    def test_round_trips_through_the_clients_decode(self):
        heights = np.array([[0.0, 1016.25, -3.5, 2228.0]], np.float32)
        out = decode(encode_terrarium(heights, np.ones_like(heights, bool)))
        np.testing.assert_array_equal(out, heights)

    # Mutation: skip the rounding, or change ROUNDING_M, and tiles grow by a
    # fifth to a third for digits finer than the data (docs/decisions/0030).
    def test_rounds_to_a_quarter_of_a_metre(self):
        heights = np.array([[100.1, 100.13, 100.4]], np.float32)
        out = decode(encode_terrarium(heights, np.ones_like(heights, bool)))
        np.testing.assert_array_equal(out, [[100.0, 100.25, 100.5]])

    # Mutation: encode no-data as height 0 and a hole in the DEM reads as sea
    # level instead of falling through to the next source.
    def test_no_data_is_the_value_the_sampler_skips(self):
        heights = np.array([[500.0, np.nan]], np.float32)
        rgb = encode_terrarium(heights, ~np.isnan(heights))
        self.assertEqual(tuple(rgb[0, 1]), (0, 0, 0))
        self.assertEqual(decode(rgb)[0, 1], -32768)


class TestHalve(unittest.TestCase):
    def test_means_each_2x2(self):
        grid = np.array([[1, 3, 10, 10], [5, 7, 10, 10]], np.float32)
        np.testing.assert_array_equal(halve(grid), [[4, 10]])

    # Mutation: a plain mean turns any 2x2 that touches the coast into no-data,
    # and the land's edge retreats a pixel at every coarser zoom.
    def test_ignores_no_data_and_keeps_all_no_data_empty(self):
        nan = np.nan
        grid = np.array([[2, nan, nan, nan], [4, nan, nan, nan]], np.float32)
        out = halve(grid)
        self.assertEqual(out[0, 0], 3)
        self.assertTrue(np.isnan(out[0, 1]))


class TestBlocks(unittest.TestCase):
    def test_a_tile_sits_under_its_parent(self):
        west, south, east, north = tile_bounds_3857(10, 939, 613)
        w2, s2, e2, n2 = tile_bounds_3857(11, 1879, 1227)
        self.assertAlmostEqual(e2, east)
        self.assertAlmostEqual(s2, south)
        self.assertGreater(w2, west)
        self.assertLess(n2, north)

    def test_an_extent_lists_every_block_it_touches(self):
        # Katoomba, with the tile the JS decode fixture names (z13 7516/4911).
        x, y = lonlat_to_tile(150.315, -33.706, 13)
        self.assertEqual((x, y), (7516, 4911))
        blocks = set(blocks_for((150.0, -34.0, 150.5, -33.5)))
        self.assertIn((x >> (13 - BLOCK_ZOOM), y >> (13 - BLOCK_ZOOM)), blocks)
        self.assertEqual(len(blocks), 6)


class TestContourSchema(unittest.TestCase):
    # Both clients pick out major lines with `elev % 50 == 0` and read the
    # `contours` source layer. Mutation: change CONTOUR_MAJOR_M or
    # CONTOUR_LAYER here alone and the archive carries lines neither client
    # draws bold, or a layer neither client reads.
    def test_layer_and_major_interval_are_the_ones_both_clients_read(self):
        from build_nsw_dem import CONTOUR_INTERVAL_M, CONTOUR_LAYER, CONTOUR_MAJOR_M

        root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
        for path, layer in (
            ("mobile/src/map/topoVectorLayers.ts", f'sourceLayer: "{CONTOUR_LAYER}"'),
            (
                "frontend/src/components/map/Map.tsx",
                f'"source-layer": "{CONTOUR_LAYER}"',
            ),
        ):
            with open(os.path.join(root, path)) as f:
                client = f.read()
            self.assertIn(f'["get", "elev"]], {CONTOUR_MAJOR_M}]', client, path)
            self.assertIn(layer, client, path)
        self.assertEqual(CONTOUR_MAJOR_M % CONTOUR_INTERVAL_M, 0)


def plane(rows: int, cols: int, rise_per_col: float) -> np.ndarray:
    """Heights that climb eastward at a constant rate."""
    return np.tile(np.arange(cols, dtype=np.float32) * rise_per_col, (rows, 1))


class TestHornSlope(unittest.TestCase):
    cell = np.full(4, 5.0)

    # Mutation: weight the neighbours 1-1-1 instead of 1-2-1, or divide by 4
    # instead of 8 cells, and every slope is off by a few degrees.
    def test_a_plane_has_its_own_slope(self):
        out = horn_slope(plane(6, 6, 10.0), self.cell)  # 10 m up per 5 m across
        np.testing.assert_allclose(out, np.degrees(np.arctan(2.0)), atol=1e-4)

    # Mutation: change a weight or the divisor in `horn_slope` (every plane
    # stays right) and the bumpy window of shared/src/__fixtures__/
    # horn-window.json reads differently; demSlope.test.ts reads the same file
    # for `slopeDegrees`, so editing the figure alone turns that test red.
    def test_a_bumpy_window_reads_as_the_clients_read_it(self):
        root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
        with open(os.path.join(root, "shared/src/__fixtures__/horn-window.json")) as f:
            fixture = json.load(f)
        window = np.array(fixture["heights"], np.float32).reshape(3, 3)
        out = horn_slope(window, np.array([fixture["cellM"]]))
        self.assertAlmostEqual(float(out[0, 0]), fixture["degrees"], places=4)

    # Mutation: NaN-ignoring sums (`np.nansum`, `np.nan_to_num`) and a hole's
    # neighbours get a slope made from the heights that are there, or drop the
    # centre `np.where` and a hole at the centre gets one: a confident number
    # about ground nobody measured (demSlopeAt returns null for the same window).
    def test_any_of_the_nine_being_no_data_makes_the_pixel_no_data(self):
        for row, col in [(0, 0), (0, 1), (0, 2), (1, 0), (1, 1), (2, 2)]:
            window = plane(3, 3, 1.0)
            window[row, col] = np.nan
            self.assertTrue(np.isnan(horn_slope(window, np.array([5.0]))[0, 0]))

    # Mutation: one cell size for the whole tile, or the equator's, and slopes
    # in the south of the state read steeper than `demSlopeAt` reports them.
    def test_a_pixel_is_smaller_further_from_the_equator(self):
        across = 2**ZMAX * TILE
        lat = -33.706
        y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * across
        got = pixel_size_m(int(y), 1)[0]
        self.assertAlmostEqual(
            got, EARTH_CIRCUMFERENCE_M * math.cos(math.radians(lat)) / across, 3
        )
        self.assertLess(got, EARTH_CIRCUMFERENCE_M / across * 0.84)
        # Down a tile (south, away from the equator) the pixels shrink, row by row.
        rows = pixel_size_m(int(y), TILE)
        self.assertTrue(np.all(np.diff(rows) < 0))

    # Mutation: change the constant here alone, or cut either figure short, and
    # archive slopes drift from what the clients compute at a tap, so a colour
    # and a number disagree.
    def test_the_earth_is_the_one_demSlope_uses(self):
        root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
        with open(os.path.join(root, "shared/src/demSlope.ts")) as f:
            found = re.search(r"EARTH_CIRCUMFERENCE_M = ([\d_.]+);", f.read())
        self.assertIsNotNone(found)
        self.assertEqual(float(found.group(1).replace("_", "")), EARTH_CIRCUMFERENCE_M)


class TestBlockSlope(unittest.TestCase):
    # Mutation: in `block_slope`, read the neighbour ring from the wrong tile
    # (`bx * tiles - 1` to `bx * tiles`), start the window at `TILE` instead of
    # `TILE - 1`, or at `top` instead of `top - 1`, or give `pixel_size_m` the
    # wrong row origin: the pixels on a tile or block edge then read a slope
    # that is not the whole mosaic's, a visible seam on every tile.
    def test_a_block_equals_horn_over_the_whole_mosaic(self):
        bx, by, tiles = 2, 3, 2
        rng = np.random.default_rng(1)
        mosaic = rng.uniform(0, 300, (4 * TILE, 4 * TILE)).astype(np.float32)

        def get(x, y):  # the mosaic holds tiles bx*2-1 .. bx*2+2
            col, row = x - (bx * tiles - 1), y - (by * tiles - 1)
            if not (0 <= col < 4 and 0 <= row < 4):
                return None
            return mosaic[row * TILE : (row + 1) * TILE, col * TILE : (col + 1) * TILE]

        got = block_slope(get, bx, by, tiles)
        want = horn_slope(
            mosaic[TILE - 1 : 3 * TILE + 1, TILE - 1 : 3 * TILE + 1],
            pixel_size_m(by * tiles * TILE, tiles * TILE),
        )
        np.testing.assert_array_equal(got, want)

    # Mutation: treat a missing neighbour as flat ground (fill 0) and the block's
    # edge pixels get a slope from ground nobody measured.
    def test_a_missing_neighbour_makes_the_edge_no_data(self):
        flat = np.zeros((TILE, TILE), np.float32)
        alone = block_slope(lambda x, y: flat if (x, y) == (1, 1) else None, 1, 1, 1)
        self.assertTrue(np.isnan(alone[[0, -1]]).all())  # the ring is missing
        self.assertTrue(np.isnan(alone[:, [0, -1]]).all())
        self.assertEqual(alone[5, 5], 0)
        ring = block_slope(lambda x, y: None if x == 0 else flat, 1, 1, 1)
        self.assertTrue(np.isnan(ring[:, 0]).all())
        self.assertEqual(ring[5, 5], 0)


class TestSlopeBlock(unittest.TestCase):
    # Mutation: `slope_block` hands `save_block` HEIGHTS instead of SLOPE (or
    # skips Horn), and a block written to the work dir carries quarter-metre
    # heights, not whole degrees; the z15 tile and its z10 parent must be there.
    def test_a_block_is_written_in_whole_degrees(self):
        import sqlite3
        import tempfile

        import build_nsw_dem

        rise = np.tile(np.arange(TILE, dtype=np.float32) * 3.0, (TILE, 1))
        png = png_bytes(encode_terrarium(rise, np.ones_like(rise, bool)))

        class Heights:  # one z15 height tile, the block's north-west corner
            def get(self, z, x, y):
                return png if (z, x, y) == (15, 7 * 32, 9 * 32) else None

        build_nsw_dem._heights = Heights()
        try:
            with tempfile.TemporaryDirectory() as work:
                job = (7, 9, work, 15, 8)
                self.assertIn("7/9", build_nsw_dem.slope_block(job))
                self.assertIsNone(build_nsw_dem.slope_block(job))  # resumed
                db = sqlite3.connect(os.path.join(work, "7-9.sqlite"))
                rows = dict(
                    ((z, x, y), data)
                    for z, x, y, data in db.execute("select z, x, y, data from tiles")
                )
                db.close()
        finally:
            build_nsw_dem._heights = None
        self.assertIn((15, 7 * 32, 9 * 32), rows)
        self.assertIn((10, 7, 9), rows)
        got = decode_terrarium(
            np.asarray(
                Image.open(io.BytesIO(rows[(15, 7 * 32, 9 * 32)])).convert("RGB")
            )
        )
        want = np.round(
            horn_slope(
                np.pad(rise, 1, constant_values=np.nan),
                pixel_size_m(9 * 32 * TILE, TILE),
            )
        )
        np.testing.assert_array_equal(got[1:-1, 1:-1], want[1:-1, 1:-1])


class TestBuildSlope(unittest.TestCase):
    # Mutation: `shutdown(wait=False, cancel_futures=True)` (the `with` block's
    # own shutdown then runs every queued block) or no cancel at all: the
    # traceback prints at once but the process runs ~1,250 blocks before it
    # exits, holding 8 vCPU for hours. Only the time to exit shows it.
    def test_a_failing_block_stops_the_queued_ones(self):
        import subprocess
        import tempfile
        import time

        here = os.path.dirname(__file__)
        script = f"""
import multiprocessing, sys, time
multiprocessing.set_start_method("fork")  # the patches below reach the children
sys.path[:0] = [{here!r}, {os.path.dirname(here)!r}]
import _native_stub
import build_nsw_dem as nd
from pathlib import Path

class Reader:
    def metadata(self):
        return {{"name": "NSW 5 m DEM", "attribution": nd.credit(nd.HEIGHTS, "October 2026")}}
    def header(self):
        return dict(min_lon_e7=1409000000, max_lon_e7=1537000000,
                    min_lat_e7=-376000000, max_lat_e7=-280000000,
                    min_zoom=8, max_zoom=15)
    def get(self, z, x, y):
        return b"1"

nd.open_heights = lambda path: Reader()
first = nd.lonlat_to_tile(140.9, -28.0, nd.BLOCK_ZOOM)

def slope_block(job):
    if job[:2] == first:
        raise ValueError("boom")
    time.sleep(0.3)

slope_block.__module__, slope_block.__qualname__ = "build_nsw_dem", "slope_block"
slope_block.__name__ = "slope_block"
nd.slope_block = slope_block
nd.build_slope(Path("unused"), Path(sys.argv[1]) / "out.pmtiles", Path(sys.argv[1]) / "w", 4)
"""
        with tempfile.TemporaryDirectory() as tmp:
            started = time.time()
            done = subprocess.run(
                [sys.executable, "-c", script, tmp],
                capture_output=True,
                text=True,
                timeout=60,
            )
            self.assertNotEqual(done.returncode, 0)
            self.assertIn("boom", done.stderr)
            self.assertLess(time.time() - started, 30)


class TestDerivedCredit(unittest.TestCase):
    # Mutation: any change to the wording or the order of `derived_credit`'s two
    # forms: NSW's published slope credit stops being `credit(SLOPE, month)`.
    def test_nsw_credit_becomes_the_slope_credit_it_always_was(self):
        self.assertEqual(
            derived_credit("Slope", credit(HEIGHTS, "October 2026")),
            credit(SLOPE, "October 2026"),
        )

    # Mutation: as above, for the contour archive's description, which `contours`
    # used to spell out by hand.
    def test_nsw_contours_credit_is_what_contours_always_wrote(self):
        self.assertEqual(
            derived_credit("Contours", credit(HEIGHTS, "October 2026")),
            "Contours derived from the NSW 5 m Digital Elevation Model, © State of"
            " New South Wales (Spatial Services), extracted October 2026."
            " CC BY 3.0 AU.",
        )

    # Mutation: drop the `else` branch's colon text and a foreign credit is lost
    # (the slope archive would carry no licence line at all).
    def test_another_archives_credit_is_kept_whole(self):
        self.assertEqual(
            derived_credit("Contours", "LINZ, CC BY 4.0"),
            "Contours derived from: LINZ, CC BY 4.0",
        )


class TestBlockZoom(unittest.TestCase):
    # Mutation: `zmax - BLOCK_DEPTH` becomes a constant 10 and a z17 archive
    # makes a 4 GB block; or the `max(.., zmin)` goes and a z14 archive that
    # starts at z12 writes z9 tiles it never had a source for.
    def test_nsw_is_z10_and_a_block_stays_32_tiles_across(self):
        self.assertEqual(block_zoom(15, 8), BLOCK_ZOOM)
        self.assertEqual(block_zoom(17, 8), 12)
        self.assertEqual(block_zoom(15, 13), 13)


class TestSlopeFromAnyArchive(unittest.TestCase):
    # Mutation: `block_slope` or `slope_block` leaves `pixel_size_m` at its
    # default z15: a z17 archive's pixels are a quarter the size, so every
    # slope reads a quarter of its real angle.
    def test_a_z17_block_uses_z17_pixels(self):
        flat_rise = np.tile(np.arange(TILE, dtype=np.float32), (TILE, 1))
        got = block_slope(lambda x, y: flat_rise, 5, 6, 1, 17)
        want = horn_slope(
            np.pad(flat_rise, 1, mode="edge"), pixel_size_m(6 * TILE, TILE, 17)
        )
        np.testing.assert_array_equal(got[1:-1, 1:-1], want[1:-1, 1:-1])
        self.assertGreater(
            float(got[100, 100]),
            float(
                horn_slope(
                    np.pad(flat_rise, 1, mode="edge"), pixel_size_m(6 * TILE, TILE, 15)
                )[100, 100]
            ),
        )

    # Mutation: `slope_block` ignores `zmax` and reads and writes z15: the z17
    # tile is missing and the block's tile is z10, not z12.
    def test_a_z17_block_is_written_at_z17_down_to_its_z12_tile(self):
        import sqlite3
        import tempfile

        import build_nsw_dem

        rise = np.tile(np.arange(TILE, dtype=np.float32) * 3.0, (TILE, 1))
        png = png_bytes(encode_terrarium(rise, np.ones_like(rise, bool)))

        class Heights:
            def get(self, z, x, y):
                return png if (z, x, y) == (17, 3 * 32, 4 * 32) else None

        build_nsw_dem._heights = Heights()
        try:
            with tempfile.TemporaryDirectory() as work:
                build_nsw_dem.slope_block((3, 4, work, 17, 8))
                db = sqlite3.connect(os.path.join(work, "3-4.sqlite"))
                zooms = {z for (z,) in db.execute("select z from tiles")}
                db.close()
        finally:
            build_nsw_dem._heights = None
        self.assertEqual(zooms, set(range(12, 18)))


class TestSlopeOfAZ17Archive(unittest.TestCase):
    # Mutation: `pack` or `build_slope` falls back to z15 and z8 anywhere (the
    # metadata, the bounds row, the block zoom, the coarse zooms): the slope of
    # a 1 m archive loses its z17 tiles or claims zooms it does not have.
    def test_heights_to_slope_keep_the_archives_own_zooms(self):
        import tempfile

        from pmtiles.reader import MmapSource, Reader, all_tiles

        import build_nsw_dem as nd

        rise = np.tile(np.arange(TILE, dtype=np.float32) * 0.5, (TILE, 1))
        grid = np.full((32 * TILE, 32 * TILE), np.nan, np.float32)
        grid[: 2 * TILE, : 2 * TILE] = np.tile(rise, (2, 2))
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            (tmp / "h").mkdir()
            # Block (3, 4) at z12, so its tiles at z17 start at (96, 128).
            nd.save_block(grid, 3, 4, tmp / "h", HEIGHTS, 17, 12)
            heights = tmp / "heights.pmtiles"
            nd.pack(tmp / "h", heights, "Test credit", HEIGHTS, 17, 10)
            slope = tmp / "slope.pmtiles"
            build_slope(heights, slope, tmp / "w", 1)
            for archive in (heights, slope):
                with open(archive, "rb") as f:
                    source = MmapSource(f)
                    header = Reader(source).header()
                    zooms = {z for (z, _, _), _ in all_tiles(source)}
                self.assertEqual((header["min_zoom"], header["max_zoom"]), (10, 17))
                self.assertEqual(zooms, set(range(10, 18)))
            with open(slope, "rb") as f:
                meta = Reader(MmapSource(f)).metadata()
        self.assertEqual(meta["attribution"], "Slope derived from: Test credit")
        self.assertEqual(meta["maxzoom"], "17")


class TestBuildSlopeCredit(unittest.TestCase):
    # Mutation: a hard-coded name or credit in `build_slope` (the old month
    # typed by hand, or "NSW 5 m DEM slope"): another archive's slope then
    # carries NSW's credit, or an NSW rebuild carries last month's.
    def _packed(self, metadata, header):
        import tempfile
        from unittest import mock

        class Reader:
            def metadata(self):
                return metadata

            def header(self):
                return header

            def get(self, z, x, y):
                return None

        with (
            tempfile.TemporaryDirectory() as tmp,
            mock.patch("build_nsw_dem.open_heights", lambda path: Reader()),
            mock.patch("build_nsw_dem.pack") as pack,
        ):
            build_slope(Path("unused"), Path(tmp) / "o", Path(tmp) / "w", 1)
        return pack.call_args

    def test_nsw_gets_the_month_the_heights_say(self):
        call = self._packed(
            {"name": "NSW 5 m DEM", "attribution": credit(HEIGHTS, "March 2031")},
            dict(
                min_lon_e7=1509000000,
                max_lon_e7=1510000000,
                min_lat_e7=-337000000,
                max_lat_e7=-336000000,
                min_zoom=8,
                max_zoom=15,
            ),
        )
        self.assertEqual(call.args[2], credit(SLOPE, "March 2031"))
        self.assertEqual(call.args[3].name, SLOPE.name)
        self.assertEqual(call.args[4:], (15, 8))

    def test_another_archive_gets_its_own_name_zooms_and_credit(self):
        call = self._packed(
            {"name": "Zion 1 m DEM", "attribution": "USGS 3DEP, public domain"},
            dict(
                min_lon_e7=-1130000000,
                max_lon_e7=-1129000000,
                min_lat_e7=372400000,
                max_lat_e7=373300000,
                min_zoom=10,
                max_zoom=17,
            ),
        )
        self.assertEqual(call.args[2], "Slope derived from: USGS 3DEP, public domain")
        self.assertEqual(call.args[3].name, "Zion 1 m DEM slope")
        self.assertEqual(call.args[4:], (17, 10))


class TestNswSlopeUnchanged(unittest.TestCase):
    # The slope archive of a heights archive built the NSW way (the Katoomba
    # fixture's tiles through `save_block` and `pack`) is what it was before
    # `build_slope` read its zooms and credit from the archive: the same tiles
    # to the whole degree, the same name and credit. The hash was taken with
    # build_nsw_dem.py before that change. Mutation: change `halve_max`, the
    # slope rounding, a zoom, or the credit's wording for NSW, and it is red.
    HASH = "8ef0ef71f2a81aa48fc68a2c2db5e785f34e91f4328c74342861bc28aab3d07d"

    def test_the_katoomba_slope_archive_is_unchanged(self):
        import hashlib
        import tempfile

        from pmtiles.reader import MmapSource, Reader, all_tiles

        import build_nsw_dem as nd

        fixture = (
            Path(__file__).resolve().parents[2]
            / "shared/src/__fixtures__/nsw-5m-z15-katoomba.pmtiles"
        )
        with open(fixture, "rb") as f:
            reader = Reader(MmapSource(f))
            h = reader.header()
            x0, y0 = lonlat_to_tile(h["min_lon_e7"] / 1e7, h["max_lat_e7"] / 1e7, 15)
            x1, y1 = lonlat_to_tile(h["max_lon_e7"] / 1e7, h["min_lat_e7"] / 1e7, 15)
            bx, by = x0 >> 5, y0 >> 5
            grid = np.full((32 * TILE, 32 * TILE), np.nan, np.float32)
            found = 0
            for x in range(x0, x1 + 1):
                for y in range(y0, y1 + 1):
                    tile = nd.height_tile(reader, 15, x, y)
                    if tile is not None:
                        row, col = (y - by * 32) * TILE, (x - bx * 32) * TILE
                        grid[row : row + TILE, col : col + TILE] = tile
                        found += 1
        self.assertEqual(found, 3)  # the fixture's own tiles: a floor
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            (tmp / "h").mkdir()
            nd.save_block(grid, bx, by, tmp / "h", HEIGHTS)
            heights = tmp / "heights.pmtiles"
            nd.pack(tmp / "h", heights, credit(HEIGHTS, "October 2026"), HEIGHTS)
            slope = tmp / "slope.pmtiles"
            build_slope(heights, slope, tmp / "w", 1)
            with open(slope, "rb") as f:
                source = MmapSource(f)
                meta = Reader(source).metadata()
                digest, count = hashlib.sha256(), 0
                for (z, x, y), data in sorted(all_tiles(source)):
                    values = decode_terrarium(
                        np.asarray(Image.open(io.BytesIO(data)).convert("RGB"))
                    )
                    digest.update(f"{z}/{x}/{y}".encode())
                    digest.update(
                        np.nan_to_num(values, nan=-1).astype(np.int16).tobytes()
                    )
                    count += 1
        self.assertEqual(meta["name"], "NSW 5 m DEM slope")
        self.assertEqual(meta["attribution"], credit(SLOPE, "October 2026"))
        self.assertEqual(count, 11)
        self.assertEqual(digest.hexdigest(), self.HASH)


class TestContourSmoothing(unittest.TestCase):
    # Mutation: a factor that is not a power of two (`round(CELL / px)`), and a
    # smoothing cell straddles a tile edge: two blocks' grids no longer line up,
    # and a line steps at every block edge.
    def test_the_factor_is_a_power_of_two_dividing_a_tile(self):
        for ground_px in (0.2, 0.86, 1.19, 2.0, 4.0, 9.0, 25.0, 500.0):
            n = smoothing_factor(ground_px)
            self.assertEqual(TILE % n, 0, ground_px)
            self.assertEqual(n & (n - 1), 0, ground_px)

    # Mutation: the target changes from CONTOUR_CELL_M, or the rounding becomes
    # floor: a z17 pixel at -44 degrees (0.86 m) gets 8 and a 7 m cell, or 1.
    def test_the_cell_is_the_one_nearest_ten_metres(self):
        self.assertEqual(smoothing_factor(0.86), 16)  # 13.8 m; 8 is 6.9 m
        self.assertEqual(smoothing_factor(4.0), 2)  # 8 m; 4 is 16 m
        self.assertEqual(smoothing_factor(10.0), 1)
        self.assertEqual(smoothing_factor(30.0), 1)  # never finer than the data


class TestCentreBox(unittest.TestCase):
    # Mutation: return the tiles' corners instead of their centres, and the
    # box's far edge (or its near one, on the float) reads as the next tile.
    def test_tile_range_reads_the_tiles_back(self):
        for z, (x0, y0, x1, y1) in (
            (15, (30048, 19630, 30082, 19664)),
            (17, (0, 0, 33, 33)),
            (12, (3000, 2000, 3000, 2000)),
        ):
            self.assertEqual(
                tile_range(centre_box(x0, y0, x1, y1, z), z), (x0, y0, x1, y1)
            )


class TestContourLines(unittest.TestCase):
    def commands(self, **kwargs):
        calls = []
        contour_lines(
            Path("r.tif"),
            Path("raw.gpkg"),
            Path("lines.gpkg"),
            lambda *command: calls.append(command),
            **kwargs,
        )
        return calls

    # Mutation: a default that differs from CONTOUR_INTERVAL_M, or a clip added
    # when none is asked for: NSW's contours (and every sharpened area's) change.
    def test_the_defaults_are_the_statewide_commands(self):
        calls = self.commands()
        self.assertEqual(calls[0][:6], ("gdal_contour", "-q", "-a", "elev", "-i", "10"))
        self.assertEqual(len(calls), 3)
        for call in calls[1:]:
            self.assertNotIn("-clipdst", call)

    # Mutation: clip only the first ogr2ogr (the `major` layer): the `minor`
    # lines of a block run over its neighbour's and are drawn twice.
    def test_the_interval_and_clip_reach_every_command(self):
        calls = self.commands(interval=20, clip=(1.0, 2.0, 3.0, 4.0))
        self.assertIn("20", calls[0])
        for call in calls[1:]:
            at = call.index("-clipdst")
            self.assertEqual(call[at + 1 : at + 5], ("1.0", "2.0", "3.0", "4.0"))


class TestContoursArchive(unittest.TestCase):
    """The block loop, with the GDAL and pmtiles steps replaced by recorders."""

    def run_archive(self, work, existing=()):
        from unittest import mock

        zmax = 17
        # One z12 block at (1000, 2000), reported by the archive's header.
        west, north = lonlat(1000, 2000, 12)
        east, south = lonlat(1001, 2001, 12)
        mosaics, clips, packed, commands = [], [], [], []

        class Reader:
            def metadata(self):
                return {"name": "Zion 1 m DEM", "attribution": "USGS 3DEP"}

            def header(self):
                return dict(
                    min_lon_e7=int((west + 1e-6) * 1e7),
                    max_lon_e7=int((east - 1e-6) * 1e7),
                    min_lat_e7=int((south + 1e-6) * 1e7),
                    max_lat_e7=int((north - 1e-6) * 1e7),
                    min_zoom=10,
                    max_zoom=zmax,
                )

            def get(self, z, x, y):
                return b"x" if z == 12 else None

        def lines(raster, raw, part, interval, clip):
            clips.append((interval, clip))
            part.write_bytes(b"")

        for name in existing:
            (work / name).write_bytes(b"")
        with (
            mock.patch("build_nsw_dem.open_heights", lambda path: Reader()),
            mock.patch("build_nsw_dem.need_pmtiles"),
            mock.patch(
                "build_nsw_dem.write_mosaic",
                lambda reader, bbox, *rest: mosaics.append((bbox, rest[-1])),
            ),
            mock.patch("build_nsw_dem.run", lambda *c: commands.append(c)),
            mock.patch("build_nsw_dem.contour_lines", lines),
            mock.patch("build_nsw_dem.pack_contours", lambda *a: packed.append(a)),
        ):
            contours_archive(Path("h"), work, work / "o.pmtiles", 20)
        return mosaics, clips, packed, commands

    # Mutation: no margin (`bx * tiles - 1` becomes `bx * tiles`): lines stop
    # short at every block edge. Or a margin of two tiles: the mosaic grows 6 %
    # for nothing.
    def test_the_mosaic_is_the_block_and_one_tile_around(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            mosaics, *_ = self.run_archive(Path(tmp))
        ((bbox, zoom),) = mosaics
        self.assertEqual(zoom, 17)
        self.assertEqual(
            tile_range(bbox, 17), (1000 * 32 - 1, 2000 * 32 - 1, 1001 * 32, 2001 * 32)
        )

    # Mutation: clip to the mosaic (margin included) and the lines of two
    # blocks overlap; clip to a box a degree out and the same.
    def test_lines_are_clipped_to_the_blocks_own_tile(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            _, clips, packed, _ = self.run_archive(Path(tmp))
        ((interval, clip),) = clips
        west, north = lonlat(1000, 2000, 12)
        east, south = lonlat(1001, 2001, 12)
        self.assertEqual((interval, clip), (20, (west, south, east, north)))
        # The credit of the heights the contours came from.
        self.assertEqual(packed[0][2], "Contours derived from: USGS 3DEP")

    # Mutation: ignore a block file already in `work`: a killed run redoes
    # every block, hours at statewide size.
    def test_a_finished_block_is_kept(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            mosaics, clips, _, _ = self.run_archive(
                Path(tmp), existing=("1000-2000.lines.gpkg",)
            )
        self.assertEqual((mosaics, clips), ([], []))


def lonlat(x, y, z):
    from build_nsw_dem import tile_lonlat

    return tile_lonlat(x, y, z)


class TestSlopeS3(unittest.TestCase):
    # Mutation: upload before the build, skip the content type, or read the
    # height archive from another key, and the maintainer publishes a half
    # build, a file clients cannot range-read, or the wrong archive.
    def test_downloads_builds_then_uploads_in_that_order(self):
        import tempfile
        from unittest import mock

        calls = []

        class Client:
            def download_file(self, bucket, key, path):
                calls.append(("download", bucket, key))
                open(path, "wb").write(b"heights")

            def upload_file(self, path, bucket, key, ExtraArgs):
                calls.append(("upload", bucket, key, ExtraArgs["ContentType"]))

        def build(heights, out, work, jobs):
            calls.append(("build", jobs))
            out.write_bytes(b"slope")

        with (
            tempfile.TemporaryDirectory() as tmp,
            mock.patch("build_nsw_dem.build_slope", build),
        ):
            slope_s3("bkt", Path(tmp), 8, Client())
        self.assertEqual(
            calls,
            [
                ("download", "bkt", HEIGHT_KEY),
                ("build", 8),
                ("upload", "bkt", SLOPE_KEY, "application/vnd.pmtiles"),
            ],
        )

    # Mutation: swallow a build error (`try: build_slope(...) except Exception:
    # pass`), or move the upload into a `finally`, and a half build is
    # published.
    def test_a_failed_build_uploads_nothing(self):
        import tempfile
        from unittest import mock

        calls = []

        class Client:
            def download_file(self, bucket, key, path):
                calls.append("download")
                open(path, "wb").write(b"heights")

            def upload_file(self, *args, **kwargs):
                calls.append("upload")

        def build(heights, out, work, jobs):
            calls.append("build")
            raise ValueError("boom")

        with (
            tempfile.TemporaryDirectory() as tmp,
            mock.patch("build_nsw_dem.build_slope", build),
        ):
            with self.assertRaises(ValueError):
                slope_s3("bkt", Path(tmp), 8, Client())
        self.assertEqual(calls, ["download", "build"])

    # Mutation: change HEIGHT_KEY alone and the task reads an archive the
    # clients do not.
    def test_the_height_key_is_the_one_the_clients_read(self):
        root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
        with open(os.path.join(root, "shared/src/regions.ts")) as f:
            self.assertIn(f'archivePath: "{HEIGHT_KEY}"', f.read())
        self.assertEqual(
            SLOPE_KEY, HEIGHT_KEY.replace("5m.pmtiles", "5m-slope.pmtiles")
        )

    # Mutation: change CONTOUR_KEY alone and an area export draws contours
    # from an archive the clients do not read.
    def test_the_contour_key_is_the_one_the_clients_read(self):
        root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
        with open(os.path.join(root, "shared/src/regions.ts")) as f:
            self.assertIn(f'archivePath: "{CONTOUR_KEY}"', f.read())


class TestHalveMax(unittest.TestCase):
    # Mutation: a mean (or `halve`) turns a one-pixel cliff into gentle ground
    # at every coarser zoom, so it vanishes from the map where it matters.
    def test_keeps_the_steepest_of_each_2x2(self):
        grid = np.array([[1, 80, 10, 10], [5, 7, 10, 12]], np.float32)
        np.testing.assert_array_equal(halve_max(grid), [[80, 12]])

    # Mutation: `SLOPE = Layer(..., halve, ...)` (ADR 0039): `halve_max` itself
    # stays right and the test above passes, but the archive drops its cliffs.
    def test_the_slope_layer_uses_it(self):
        self.assertIs(SLOPE.reduce, halve_max)

    # Mutation: a plain max propagates NaN and the coast's edge pixels, next to
    # a no-data pixel, lose their slope at every zoom; a fill of 0 does the same
    # for a quad that is all no-data, which must stay empty.
    def test_ignores_no_data_and_keeps_all_no_data_empty(self):
        nan = np.nan
        grid = np.array([[2, nan, nan, nan], [4, nan, nan, nan]], np.float32)
        out = halve_max(grid)
        self.assertEqual(out[0, 0], 4)
        self.assertTrue(np.isnan(out[0, 1]))


class TestSlopeEncoding(unittest.TestCase):
    # Mutation: encode with ROUNDING_M (a quarter) instead of the slope's whole
    # degrees and the archive grows by a third for digits no band can show.
    def test_rounds_to_a_whole_degree_and_round_trips(self):
        slope = np.array([[0.4, 0.6, 63.43, 90.0]], np.float32)
        rgb = encode_terrarium(slope, ~np.isnan(slope), SLOPE.rounding)
        np.testing.assert_array_equal(decode(rgb), [[0, 1, 63, 90]])
        np.testing.assert_array_equal(decode_terrarium(rgb), [[0, 1, 63, 90]])

    # Mutation: treat a slope of 0 as no-data (a `if value` test) and every flat
    # lake and floodplain becomes a hole the clients draw nothing on.
    def test_flat_ground_is_not_no_data(self):
        flat = np.array([[0.0, np.nan]], np.float32)
        rgb = encode_terrarium(flat, ~np.isnan(flat), SLOPE.rounding)
        self.assertNotEqual(tuple(rgb[0, 0]), (0, 0, 0))
        out = decode_terrarium(rgb)
        self.assertEqual(out[0, 0], 0)
        self.assertTrue(np.isnan(out[0, 1]))

    # Mutation: `tiles_of` ignores its layer's rounding or PNG level (uses
    # ROUNDING_M or level 9) and slope tiles carry quarter-degree steps at the
    # heights' cost. The call sites are held by `TestSlopeBlock`.
    def test_a_slope_tile_is_written_with_the_slope_layer(self):
        grid = np.full((TILE, TILE), 12.4, np.float32)
        (z, x, y, png), *_ = tiles_of(grid, 15, 3, 4, SLOPE)
        self.assertEqual((z, x, y), (15, 3, 4))
        rgb = np.asarray(Image.open(io.BytesIO(png)).convert("RGB"))
        np.testing.assert_array_equal(decode_terrarium(rgb), 12.0)
        self.assertEqual(png, png_bytes(encode_terrarium(grid, grid > 0, 1.0), 6))

    # Mutation: change the credit's wording for one archive alone and the
    # slope carries a different licence line than the heights it derives from.
    # The month is not compared: a rebuild changes it (ADR 0031).
    def test_both_archives_carry_the_credit_of_the_heights(self):
        root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
        with open(os.path.join(root, "shared/src/regions.ts")) as f:
            source = f.read()
        tail = credit(HEIGHTS, "X").split("the NSW 5 m", 1)[1].split("extracted")[0]
        self.assertIn(tail + "extracted", source)
        slope = credit(SLOPE, "X").split("the NSW 5 m", 1)[1]
        self.assertEqual(slope.split("extracted")[0], tail)
        self.assertTrue(slope.endswith("CC BY 3.0 AU."))


if __name__ == "__main__":
    unittest.main()
