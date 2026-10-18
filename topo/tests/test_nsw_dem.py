"""Unit tests for the pure pieces of build_nsw_dem.py: the terrarium encoding
the clients decode, the 2x2 averaging between zooms, and the block maths.

build_nsw_dem.py imports osgeo at module top, so it is stubbed first (the
topo/tests/_native_stub.py convention).
"""

import math
import os
import sys
import unittest

import numpy as np

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
    blocks_for,
    credit,
    decode_terrarium,
    encode_terrarium,
    halve,
    halve_max,
    horn_slope,
    lonlat_to_tile,
    pixel_size_m,
    tile_bounds_3857,
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

    # Mutation: leave the border out of the window (NaN it, or edge-replicate
    # it) and the pixels on a tile edge read as no-data or gentler than their
    # neighbours, a visible seam on every tile of the archive.
    def test_two_halves_with_a_border_equal_the_whole(self):
        rng = np.random.default_rng(1)
        ground = rng.uniform(0, 200, (6, 10)).astype(np.float32)
        cell = np.full(4, 5.0)
        whole = horn_slope(ground, cell)
        left = horn_slope(ground[:, :6], cell)  # inner columns 1..4
        right = horn_slope(ground[:, 4:], cell)  # inner columns 5..8
        np.testing.assert_array_equal(np.hstack([left, right]), whole)

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

    # Mutation: change the constant here alone and archive slopes drift from
    # what the clients compute at a tap, so a colour and a number disagree.
    def test_the_earth_is_the_one_demSlope_uses(self):
        root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
        with open(os.path.join(root, "shared/src/demSlope.ts")) as f:
            self.assertIn(
                f"EARTH_CIRCUMFERENCE_M = {EARTH_CIRCUMFERENCE_M:_.3f}".rstrip("0"),
                f.read(),
            )


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

    # Mutation: change the credit's wording for one archive alone and the
    # slope carries a different licence line than the heights it derives from.
    def test_both_archives_carry_the_credit_of_the_heights(self):
        root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
        with open(os.path.join(root, "shared/src/demSources.ts")) as f:
            source = f.read()
        tail = credit(HEIGHTS, "October 2026").split("the NSW 5 m", 1)[1]
        self.assertIn(tail, source)
        self.assertEqual(credit(SLOPE, "October 2026").split("the NSW 5 m", 1)[1], tail)


if __name__ == "__main__":
    unittest.main()
