"""Unit tests for the pure pieces of build_nsw_dem.py: the terrarium encoding
the clients decode, the 2x2 averaging between zooms, and the block maths.

build_nsw_dem.py imports osgeo at module top, so it is stubbed first (the
topo/tests/_native_stub.py convention).
"""

import io
import math
import os
import re
import sys
import unittest

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import _native_stub  # noqa: F401,E402  (stubs osgeo when absent on the host)

from build_nsw_dem import (  # noqa: E402
    BLOCK_ZOOM,
    EARTH_CIRCUMFERENCE_M,
    HEIGHTS,
    SLOPE,
    TILE,
    ZMAX,
    block_slope,
    blocks_for,
    credit,
    decode_terrarium,
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

    # Mutation: change a weight or the divisor in `horn_slope` in step on a
    # plane (every plane stays right) and a bumpy window reads differently from
    # `slopeDegrees` in shared/src/demSlope.ts, which asserts the same window
    # and figure in demSlope.test.ts.
    def test_a_bumpy_window_reads_as_the_clients_read_it(self):
        window = np.array([[10, 12, 17], [9, 15, 20], [11, 14, 25]], np.float32)
        out = horn_slope(window, np.array([4.5]))
        self.assertAlmostEqual(float(out[0, 0]), 51.29179169379886, places=4)

    # Mutation: check only the centre pixel and a hole's neighbours get a slope
    # made from the eight heights that are there: a confident number about
    # ground nobody measured (demSlopeAt returns null for the same window).
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


class TestHalveMax(unittest.TestCase):
    # Mutation: a mean (or `halve`) turns a one-pixel cliff into gentle ground
    # at every coarser zoom, so it vanishes from the map where it matters.
    def test_keeps_the_steepest_of_each_2x2(self):
        grid = np.array([[1, 80, 10, 10], [5, 7, 10, 12]], np.float32)
        np.testing.assert_array_equal(halve_max(grid), [[80, 12]])

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

    # Mutation: pass `HEIGHTS` (or nothing) where `SLOPE` belongs in the tiling
    # and a slope archive is written with the heights' quarter-metre steps and
    # level 9; the slope's tile must decode in whole degrees.
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
        with open(os.path.join(root, "shared/src/demSources.ts")) as f:
            source = f.read()
        tail = credit(HEIGHTS, "X").split("the NSW 5 m", 1)[1].split("extracted")[0]
        self.assertIn(tail + "extracted", source)
        slope = credit(SLOPE, "X").split("the NSW 5 m", 1)[1]
        self.assertEqual(slope.split("extracted")[0], tail)
        self.assertTrue(slope.endswith("CC BY 3.0 AU."))


if __name__ == "__main__":
    unittest.main()
