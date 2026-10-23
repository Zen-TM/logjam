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
from pathlib import Path

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import _native_stub  # noqa: F401,E402

import build_nsw_dem as dem  # noqa: E402
from sharpen import (  # noqa: E402
    CannotSharpen,
    blocks_of,
    block_grids,
    cell_for_density,
    class2_cell,
    contour_archive,
    credit,
    dem_plan,
    extraction_month,
    mosaic_bounds,
    pyramid,
    sharpen_block,
    tin_workers,
    z15_mosaic,
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
        # A Category 2 survey's class 2 holds ~0.12 pts/m² (measured on NSW tiles).
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
    """Mutations that turn it red: the slope pyramid by the mean (a cliff
    fades out of its band zoomed out, ADR 0039), and heights rounded to the
    same step at every zoom (terraces in the hillshade at z17)."""

    def test_heights_round_finer_with_each_zoom(self):
        from PIL import Image
        import io

        def first_pixel_per_zoom(value):
            grid = np.full((2048, 2048), value, np.float32)
            return {
                z: float(
                    dem.decode_terrarium(
                        np.asarray(Image.open(io.BytesIO(png)).convert("RGB"))
                    )[0, 0]
                )
                for z, x, y, png in pyramid(grid, 17, 0, 0, HEIGHTS)
                if (x, y) == (0, 0)
            }

        # To the nearest 1/16 m at z17, 1/8 m at z16, 1/4 m at z15.
        self.assertEqual(
            first_pixel_per_zoom(100.05), {17: 100.0625, 16: 100.0, 15: 100.0}
        )
        self.assertEqual(
            first_pixel_per_zoom(100.1), {17: 100.125, 16: 100.125, 15: 100.0}
        )

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
    """Mutations that turn it red: the month taken from the oldest entry, and
    a zero DOS date taken as a date (the job then fails after all its work)."""

    def zip_dated(self, *dates):
        tmp = tempfile.mkdtemp()
        path = os.path.join(tmp, "a.zip")
        with zipfile.ZipFile(path, "w") as zf:
            for n, when in enumerate(dates):
                zf.writestr(zipfile.ZipInfo(f"x{n}", when), b"")
        return path

    def test_the_month_elvis_packed_the_zip(self):
        path = self.zip_dated((2025, 3, 1, 0, 0, 0), (2026, 10, 2, 0, 0, 0))
        self.assertEqual(extraction_month(path), "October 2026")
        self.assertIn("extracted October 2026. CC BY 3.0 AU", credit("October 2026"))

    def test_an_entry_with_no_date_is_skipped(self):
        path = self.zip_dated((2025, 3, 1, 0, 0, 0), (1980, 0, 0, 0, 0, 0))
        self.assertEqual(extraction_month(path), "March 2025")
        self.assertIsNone(extraction_month(self.zip_dated((1980, 0, 0, 0, 0, 0))))
        self.assertNotIn("extracted", credit(None))


class TestGround(unittest.TestCase):
    """Mutations that turn it red: LAZ chosen over a usable DEM, a ZIP of LAZ
    and 5 m DEMs refused, the DEMs mosaicked fine to coarse (a coarse one wins
    where they overlap), and an empty class 2 gridded anyway (or re-classified)."""

    def test_a_dem_finer_than_5m_beats_the_point_clouds(self):
        self.assertEqual(dem_plan([2.0], has_laz=True), (16, [0]))

    def test_5m_dems_are_dropped_and_the_finest_drawn_last(self):
        self.assertEqual(dem_plan([5.0, 1.0, 2.0], has_laz=False), (17, [2, 1]))

    def test_laz_with_only_5m_dems_grids_the_class_2(self):
        self.assertEqual(dem_plan([5.0], has_laz=True), (None, []))
        self.assertEqual(dem_plan([], has_laz=True), (None, []))

    def test_only_5m_dems_is_refused(self):
        with self.assertRaises(CannotSharpen) as ctx:
            dem_plan([5.0, 5.0], has_laz=False)
        self.assertIn("5 m", str(ctx.exception))

    def test_no_class_2_is_refused(self):
        with self.assertRaises(CannotSharpen) as ctx:
            class2_cell(0, 4e6)
        self.assertIn("no ground", str(ctx.exception))
        self.assertEqual(class2_cell(int(0.12 * 4e6), 4e6), 2)


class TestTinWorkers(unittest.TestCase):
    """Mutation that turns it red: the pool sized by CPUs alone, so eight
    dense TIN jobs at once run a 16 GB task out of memory."""

    def test_bounded_by_memory_as_well_as_cpus(self):
        gib = 2**30
        # A Category 1 tile and its eight neighbours: ~45 M ground points.
        self.assertEqual(tin_workers(8, 45_000_000, 16 * gib), 1)
        self.assertEqual(tin_workers(8, 5_000_000, 16 * gib), 8)
        self.assertEqual(tin_workers(8, 5_000_000, 4 * gib), 2)
        self.assertEqual(tin_workers(8, 10**10, gib), 1)


class TestMosaic(unittest.TestCase):
    """Mutations that turn it red: a wrong offset in the tiles the mosaic reads
    (the fill lands a tile away) or bounds that don't match them."""

    def test_each_tile_lands_in_its_place(self):
        bx, by = 1000, 2000
        grid = z15_mosaic(
            lambda x, y: np.full((256, 256), x * 10 + y, np.float32), bx, by
        )
        for row in range(4):
            for col in range(4):
                x, y = 2 * bx - 1 + col, 2 * by - 1 + row
                self.assertEqual(
                    float(grid[row * 256 + 128, col * 256 + 128]), x * 10 + y
                )

    def test_bounds_are_those_tiles(self):
        bx, by = 1000, 2000
        west, south, east, north = mosaic_bounds(bx, by)
        self.assertEqual(
            (west, north), dem.tile_bounds_3857(15, 2 * bx - 1, 2 * by - 1)[0::3]
        )
        tw, ts, te, tn = dem.tile_bounds_3857(14, bx, by)
        span = te - tw
        self.assertAlmostEqual(east - west, 2 * span)
        self.assertAlmostEqual(north - south, 2 * span)
        self.assertAlmostEqual(west, tw - span / 2)


class TestSharpenBlock(unittest.TestCase):
    """A block's work files are named by its position, never its tile: a
    traceback that prints a path then says nothing of where. Mutation that
    turns it red: name them `{bx}-{by}` again."""

    def test_work_files_name_no_tile(self):
        from unittest import mock

        import sharpen

        bx, by = 15031, 9824
        with tempfile.TemporaryDirectory() as tmp:
            reader = mock.Mock()
            reader.get.return_value = None
            sharpen._ctx.update(
                heights=reader, slope=reader, ground="g", zmax=16, work=Path(tmp)
            )
            n = 2 * 256 * 2 + 2 * sharpen.MARGIN_PX
            with (
                mock.patch.object(
                    sharpen, "_warp", return_value=np.full((n, n), 500.0, np.float32)
                ),
                mock.patch.object(sharpen.pipeline, "gdal") as gdal,
            ):
                count = sharpen_block((3, bx, by))
            names = sorted(os.listdir(tmp))
            written = [
                c.args[0]
                for c in gdal.GetDriverByName.return_value.Create.call_args_list
                if c.args[0]  # in-memory datasets have no name
            ]
        self.assertGreater(count, 0)
        self.assertEqual(names, ["block-3.sqlite"])
        self.assertEqual([os.path.basename(w) for w in written], ["contour-3.tif"])
        for name in names + written:
            self.assertNotIn(str(bx), name)
            self.assertNotIn(str(by), name)


class TestContourArchive(unittest.TestCase):
    """Mutation that turns it red: converting an empty MBTiles (pmtiles raises,
    and the job fails) instead of leaving the contours to the statewide layer."""

    def test_no_contour_crosses_the_area(self):
        import sqlite3
        from unittest import mock

        import sharpen

        def fake_run(*command):
            if "MVT" in command:
                db = sqlite3.connect(command[command.index("MVT") + 1])
                db.execute(
                    "create table tiles (zoom_level, tile_column, tile_row, tile_data)"
                )
                db.commit()
                db.close()
            return ""

        with tempfile.TemporaryDirectory() as tmp:
            with (
                mock.patch.object(sharpen, "run", side_effect=fake_run),
                mock.patch.object(sharpen.pipeline, "gdal"),
                mock.patch("pmtiles.convert.mbtiles_to_pmtiles") as convert,
            ):
                made = contour_archive(Path(tmp), Path(tmp), "October 2026")
            self.assertFalse(made)
            convert.assert_not_called()
            self.assertEqual(os.listdir(tmp), [])


if __name__ == "__main__":
    unittest.main()
