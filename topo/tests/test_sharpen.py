"""Unit tests for the pure pieces of sharpen.py: the zoom a ground grid
supports, the tile range, the per-pixel fill and the block grids.

sharpen.py imports pipeline.py, which imports osgeo at module top, so it is
stubbed first (the topo/tests/_native_stub.py convention).
"""

import os
import sys
import tempfile
import unittest
import zipfile

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import _native_stub  # noqa: F401,E402

import build_nsw_dem as dem  # noqa: E402
from sharpen import (  # noqa: E402
    blocks_of,
    block_grids,
    cell_for_density,
    credit,
    extraction_month,
    fill,
    pyramid,
    tile_range,
    zoom_for_cell,
    HEIGHTS,
    SLOPE,
)


class TestZoom(unittest.TestCase):
    """Mutation that turns it red: 5 m mapped to z16 (a ZIP of 5 m DEMs would
    be "sharpened" into the statewide data again)."""

    def test_a_cell_sets_the_deepest_zoom(self):
        self.assertEqual(zoom_for_cell(1.0), 17)
        self.assertEqual(zoom_for_cell(2.0), 16)
        self.assertIsNone(zoom_for_cell(5.0))

    def test_ground_density_sets_the_cell(self):
        # Lab, Q1: a Category 2 survey's class 2 is ~0.12 pts/m².
        self.assertEqual(cell_for_density(0.12), 2)
        self.assertEqual(cell_for_density(2.0), 1)


class TestTileRange(unittest.TestCase):
    """Mutation that turns it red: dropping the widening to whole z14 tiles,
    which leaves the contour range (tiles15 >> 1) wider than the rasters'."""

    def test_widened_to_whole_z14_tiles(self):
        bbox = (150.30, -33.79, 150.32, -33.77)
        x0, y0, x1, y1 = tile_range(bbox)
        self.assertEqual((x0 % 2, y0 % 2, x1 % 2, y1 % 2), (0, 0, 1, 1))
        lx0, ly0 = dem.lonlat_to_tile(bbox[0], bbox[3], 15)
        lx1, ly1 = dem.lonlat_to_tile(bbox[2], bbox[1], 15)
        self.assertTrue(x0 <= lx0 and y0 <= ly0 and x1 >= lx1 and y1 >= ly1)
        self.assertTrue(lx0 - x0 <= 1 and x1 - lx1 <= 1)

    def test_blocks_are_the_z14_tiles(self):
        self.assertEqual(blocks_of((10, 20, 13, 21)), [(5, 10), (6, 10)])


class TestBlockGrids(unittest.TestCase):
    """Mutations that turn it red: Horn over the filled heights (the seam
    reads as slope), the fill taken the wrong way round, or the margin left
    on the archive grids."""

    m = 2
    size = 8

    def grids(self):
        n = self.size + 2 * self.m
        # A plane rising 1 m a pixel eastward, survey ground on the west half;
        # the statewide surface is the same plane 3 m higher.
        cols = np.tile(np.arange(n, dtype=np.float32), (n, 1))
        ground = cols.copy()
        ground[:, n // 2 :] = np.nan
        heights = cols + 3
        slope = np.full((n, n), 77.0, np.float32)
        return ground, heights, slope

    def test_heights_are_the_survey_then_the_statewide(self):
        ground, heights, slope = self.grids()
        out, _, filled = block_grids(ground, heights, slope, 0, 17, self.m)
        self.assertEqual(out.shape, (self.size, self.size))
        self.assertEqual(filled.shape, ground.shape)
        np.testing.assert_array_equal(out[:, 0], ground[self.m : -self.m, self.m])
        np.testing.assert_array_equal(
            out[:, -1], heights[self.m : -self.m, -self.m - 1]
        )

    def test_slope_never_reads_across_the_seam(self):
        ground, heights, slope = self.grids()
        _, out, _ = block_grids(ground, heights, slope, 0, 17, self.m)
        self.assertEqual(out.shape, (self.size, self.size))
        # The survey's own pixels: Horn of a 1 m-a-pixel plane, never the
        # 3 m step to the statewide surface.
        cell = dem.pixel_size_m(0, self.size, 17)[0]
        want = np.degrees(np.arctan(1 / cell))
        self.assertAlmostEqual(float(out[0, 0]), want, places=3)
        # Any pixel whose window reaches the statewide half takes its slope.
        self.assertEqual(float(out[0, self.size // 2 - self.m + 1]), 77.0)
        self.assertEqual(float(out[0, -1]), 77.0)


class TestPyramid(unittest.TestCase):
    """Mutation that turns it red: the slope pyramid by the mean (a cliff
    fades out of its band zoomed out, ADR 0039)."""

    def test_every_zoom_from_zmax_to_z15_at_the_blocks_tiles(self):
        grid = np.zeros((1024, 1024), np.float32)
        tiles = {(z, x, y) for z, x, y, _ in pyramid(grid, 16, 5, 7, HEIGHTS)}
        self.assertEqual(
            tiles,
            {(16, x, y) for x in range(20, 24) for y in range(28, 32)}
            | {(15, x, y) for x in range(10, 12) for y in range(14, 16)},
        )

    def test_slope_keeps_the_steepest(self):
        grid = np.zeros((1024, 1024), np.float32)
        grid[0, 0] = 80.0
        tiles = {(z, x, y): png for z, x, y, png in pyramid(grid, 16, 0, 0, SLOPE)}
        from PIL import Image
        import io

        z15 = dem.decode_terrarium(
            np.asarray(Image.open(io.BytesIO(tiles[(15, 0, 0)])).convert("RGB"))
        )
        self.assertEqual(float(z15[0, 0]), 80.0)


class TestCredit(unittest.TestCase):
    def test_the_month_elvis_packed_the_zip(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "a.zip")
            with zipfile.ZipFile(path, "w") as zf:
                for when in ((2025, 3, 1, 0, 0, 0), (2026, 10, 2, 0, 0, 0)):
                    zf.writestr(zipfile.ZipInfo("x" + str(when[0]), when), b"")
            self.assertEqual(extraction_month(path), "October 2026")
        self.assertIn("extracted October 2026. CC BY 3.0 AU", credit("October 2026"))


class TestFill(unittest.TestCase):
    def test_nan_takes_the_statewide_value(self):
        out = fill(np.array([1.0, np.nan]), np.array([5.0, 6.0]))
        np.testing.assert_array_equal(out, [1.0, 6.0])


if __name__ == "__main__":
    unittest.main()
