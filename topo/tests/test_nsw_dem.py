"""Unit tests for the pure pieces of build_nsw_dem.py: the terrarium encoding
the clients decode, the 2x2 averaging between zooms, and the block maths.

build_nsw_dem.py imports osgeo at module top, so it is stubbed first (the
topo/tests/_native_stub.py convention).
"""

import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import _native_stub  # noqa: F401,E402  (stubs osgeo when absent on the host)

from build_nsw_dem import (  # noqa: E402
    BLOCK_ZOOM,
    blocks_for,
    encode_terrarium,
    halve,
    lonlat_to_tile,
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


if __name__ == "__main__":
    unittest.main()
