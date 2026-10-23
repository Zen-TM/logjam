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
import pipeline  # noqa: E402
import sharpen as sharpen_module  # noqa: E402
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
    same step at every zoom (terraces in the hillshade at z17, ADR 0030's
    update of 2026-10-23)."""

    def test_heights_round_finer_with_each_zoom(self):
        import io

        from PIL import Image

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
    a DOS date that is no date (month 0 or 13, day 0, hour 25) taken as one
    (the job then fails after all its work)."""

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
        # Fields DOS can hold that no date has: month 13, day 0, hour 25.
        for bad in (
            (2026, 13, 1, 0, 0, 0),
            (2026, 1, 0, 0, 0, 0),
            (2026, 1, 1, 25, 0, 0),
        ):
            self.assertEqual(
                extraction_month(self.zip_dated((2025, 3, 1, 0, 0, 0), bad)),
                "March 2025",
            )
        self.assertIsNone(extraction_month(self.zip_dated((1980, 0, 0, 0, 0, 0))))
        self.assertNotIn("extracted", credit(None))


class TestResult(unittest.TestCase):
    """Mutations that turn it red: a field of the result renamed or retyped
    on the worker's side, which the API's parser would then read as no area
    (api/src/services/sharpenedAreas.unit.test.ts reads the same example),
    and an example whose tile range is not its coverage's."""

    def test_the_result_is_the_example_the_api_reads(self):
        import json

        root = os.path.join(os.path.dirname(__file__), "..", "..")
        path = os.path.join(root, "shared/src/__fixtures__/sharpen-result.json")
        with open(path) as f:
            stored = json.load(f)["stored"]
        reported = sharpen_module.sharpen_result(
            stored["zmax"],
            sharpen_module.tile_range(tuple(stored["coverage"])),
            tuple(stored["coverage"]),
            stored["ground"],
            stored["extracted"],
        )
        added_by_the_worker = {"keys", "vegetation"}
        self.assertEqual(
            reported, {k: v for k, v in stored.items() if k not in added_by_the_worker}
        )


class TestGround(unittest.TestCase):
    """Mutations that turn it red: LAZ chosen over a usable DEM, a ZIP of LAZ
    and 5 m DEMs refused, the DEMs mosaicked fine to coarse (a coarse one wins
    where they overlap), an empty DEM taken over the point clouds (or setting
    zmax), and an empty class 2 gridded anyway. `dem_cell` reporting a cell
    for a DEM with no valid pixel (its emptiness check deleted) turns
    `test_an_empty_dem_has_no_cell` red."""

    def test_an_empty_dem_has_no_cell(self):
        from unittest import mock

        import sharpen

        with mock.patch.object(sharpen.pipeline, "gdal") as gdal:
            gdal.Open.return_value.GetGeoTransform.return_value = (
                0,
                2.0,
                0,
                0,
                0,
                -2.0,
            )
            with mock.patch.object(
                sharpen.pipeline, "raster_has_valid_pixels", return_value=False
            ):
                self.assertIsNone(sharpen.dem_cell(Path("empty.tif")))
            with mock.patch.object(
                sharpen.pipeline, "raster_has_valid_pixels", return_value=True
            ):
                self.assertEqual(sharpen.dem_cell(Path("full.tif")), 2.0)

    def test_an_empty_dem_is_dropped(self):
        # None: a DEM with no height in it.
        self.assertEqual(dem_plan([None], has_laz=True), (None, []))
        self.assertEqual(dem_plan([None, 2.0], has_laz=False), (16, [1]))
        with self.assertRaises(CannotSharpen) as ctx:
            dem_plan([None], has_laz=False)
        self.assertIn("couldn't map any ground", str(ctx.exception))
        with self.assertRaises(CannotSharpen) as ctx:
            dem_plan([None, 5.0], has_laz=False)
        self.assertIn("5 m", str(ctx.exception))

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


class TestGroundSteps(unittest.TestCase):
    """The ground steps' calls, with PDAL and GDAL mocked.

    Mutations that turn it red: an SMRF (or any re-classifying) fallback when
    class 2 is empty; the DEM mosaic at the default resolution, or a coarser
    DEM upsampled nearest (2 x 2 blocks in the hillshade), whether dem_ground
    stops asking or merge_dem_tiles stops forwarding; require_ground's call
    removed, so a ground grid with no height goes on to claim the whole area;
    and TIN results collected without a progress write (the reaper fails a
    long dense job while it works)."""

    def test_class_2_only_and_never_smrf(self):
        from unittest import mock

        import sharpen

        calls = []

        def fake_run(*command):
            calls.append(command)
            return ""

        summary = {
            "bounds": {"minx": 0, "maxx": 2000, "miny": 0, "maxy": 2000},
            "num_points": 0,
        }
        with (
            tempfile.TemporaryDirectory() as tmp,
            mock.patch.object(sharpen, "run", side_effect=fake_run),
            mock.patch.object(sharpen, "las_summary", return_value=summary),
            mock.patch.object(
                sharpen.pipeline,
                "select_surveys_by_layer",
                return_value=mock.Mock(terrain_tiles=["a.laz", "b.laz"]),
            ),
        ):
            with self.assertRaises(CannotSharpen) as ctx:
                sharpen.laz_ground([Path("a.laz")], "g.tif", Path(tmp), 2)
        self.assertIn("no ground", str(ctx.exception))
        self.assertEqual(len(calls), 2)
        for command in calls:
            self.assertIn("--filters.range.limits=Classification[2:2]", command)
            self.assertNotIn("smrf", " ".join(command).lower())

    def test_dems_mosaic_at_the_finest_cell_upsampled_bilinear(self):
        from unittest import mock

        import sharpen

        files = [Path("a.tif"), Path("b.tif"), Path("c.tif")]
        with mock.patch.object(sharpen.pipeline, "merge_dem_tiles") as merge:
            sharpen.dem_ground(files, [2, 0], "g.tif")
        merge.assert_called_once_with(
            [files[2], files[0]], "g.tif", resolution="highest", resample="bilinear"
        )

    def test_a_ground_grid_with_no_height_is_refused_before_the_footprint(self):
        from types import SimpleNamespace
        from unittest import mock

        import sharpen

        contents = SimpleNamespace(dem_files=[Path("a.tif")], las_files=[])
        with (
            tempfile.TemporaryDirectory() as tmp,
            mock.patch.object(
                sharpen.pipeline, "extract_elvis_zip", return_value=contents
            ),
            mock.patch.object(sharpen, "extraction_month", return_value=None),
            mock.patch.object(sharpen, "dem_cell", return_value=1.0),
            mock.patch.object(sharpen, "dem_ground"),
            mock.patch.object(
                sharpen.pipeline, "raster_has_valid_pixels", return_value=False
            ),
            mock.patch.object(sharpen.pipeline, "compute_data_footprint") as footprint,
        ):
            args = SimpleNamespace(zip="in.zip", out=tmp, workers=1, metrics_json=None)
            with self.assertRaises(CannotSharpen) as ctx:
                sharpen.sharpen(args)
        self.assertIn("couldn't map any ground", str(ctx.exception))
        footprint.assert_not_called()

    def test_merge_forwards_the_cell_and_the_resampling(self):
        from unittest import mock

        with (
            tempfile.TemporaryDirectory() as tmp,
            mock.patch.object(pipeline, "gdal") as gdal,
            mock.patch.object(pipeline, "_distinct_raster_crs", return_value={"one"}),
        ):
            gdal.Open.return_value.GetRasterBand.return_value.GetNoDataValue.return_value = -9999
            out = os.path.join(tmp, "g.tif")
            pipeline.merge_dem_tiles([Path("a.tif")], out)
            legacy = gdal.BuildVRT.call_args.kwargs
            pipeline.merge_dem_tiles(
                [Path("a.tif")], out, resolution="highest", resample="bilinear"
            )
            sharpened = gdal.BuildVRT.call_args.kwargs
        # The legacy pipeline's mosaic, as it was: gdalbuildvrt's defaults.
        self.assertEqual(legacy["resolution"], "average")
        self.assertNotIn("resampleAlg", legacy)
        self.assertEqual(sharpened["resolution"], "highest")
        self.assertEqual(sharpened["resampleAlg"], "bilinear")

    def test_the_tin_phase_reports_progress_per_job(self):
        from concurrent.futures import ThreadPoolExecutor
        from unittest import mock

        import sharpen

        summary = {
            "bounds": {"minx": 0, "maxx": 2000, "miny": 0, "maxy": 2000},
            "num_points": 500_000,
        }
        tiles = ["a.laz", "b.laz", "c.laz"]
        with (
            tempfile.TemporaryDirectory() as tmp,
            mock.patch.object(sharpen, "run", return_value=""),
            mock.patch.object(sharpen, "las_summary", return_value=summary),
            mock.patch.object(
                sharpen.pipeline,
                "select_surveys_by_layer",
                return_value=mock.Mock(terrain_tiles=tiles),
            ),
            mock.patch.object(sharpen, "ProcessPoolExecutor", ThreadPoolExecutor),
            mock.patch.object(sharpen, "_tin_tile", side_effect=lambda job: job[4]),
            mock.patch.object(sharpen, "available_memory", return_value=2**34),
            mock.patch.object(sharpen.pipeline, "merge_dem_tiles"),
            mock.patch.object(sharpen.pipeline, "_write_progress") as progress,
        ):
            sharpen.laz_ground([Path(t) for t in tiles], "g.tif", Path(tmp), 2)
        tin = [c.args for c in progress.call_args_list if c.args[2] == "tin"]
        self.assertEqual(tin, [(1, 3, "tin"), (2, 3, "tin"), (3, 3, "tin")])


LEAK = "Katoomba201804-LID2-C3-AHD_2506258_56_0002_0002.laz"


def _fails_in_a_pool():
    raise RuntimeError(f"pdal failed on {LEAK}")


class TestReportFailure(unittest.TestCase):
    """A failure leaves sharpen.py as its type and code locations, never its
    message, which can quote an input's ELVIS name. Mutations that turn it
    red: print the exception itself, and leave out a pool job's own frames
    (most of the work runs in pools, and the line is all the log gets)."""

    def test_a_pool_jobs_frames_without_its_message(self):
        from concurrent.futures import ProcessPoolExecutor

        with ProcessPoolExecutor(1) as pool:
            try:
                pool.submit(_fails_in_a_pool).result()
            except RuntimeError as error:
                report = pipeline.report_failure(error, "sharpen")
        line = _fails_in_a_pool.__code__.co_firstlineno + 1
        self.assertIn(f"test_sharpen.py:{line}", report)
        for part in ("Katoomba", "2506258", "pdal failed"):
            self.assertNotIn(part, report)

    def test_main_reports_no_message(self):
        import contextlib
        import io
        import sys
        from unittest import mock

        import sharpen

        leak = "Katoomba201804-LID2-C3-AHD_2506258_56_0002_0002.laz"
        err = io.StringIO()
        with (
            tempfile.TemporaryDirectory() as tmp,
            mock.patch.object(
                sharpen, "sharpen", side_effect=RuntimeError(f"pdal failed on {leak}")
            ),
            mock.patch.object(sys, "argv", ["sharpen.py", "in.zip", tmp]),
            contextlib.redirect_stderr(err),
            self.assertRaises(SystemExit) as ctx,
        ):
            sharpen.main()
        self.assertEqual(ctx.exception.code, 1)
        self.assertIn("RuntimeError at", err.getvalue())
        self.assertIn("sharpen.py:", err.getvalue())
        for part in ("Katoomba", "2506258", "pdal failed"):
            self.assertNotIn(part, err.getvalue())


class TestTinWorkers(unittest.TestCase):
    """Mutations that turn it red: the pool sized by CPUs alone, so eight
    dense TIN jobs at once run a 16 GB task out of memory; a job that fits in
    memory alone refused because it misses the pool's share; one that
    doesn't fit run anyway (an out-of-memory kill after the work); and free
    memory read with the page cache counted as held, or below zero."""

    def test_bounded_by_memory_as_well_as_cpus(self):
        gib = 2**30
        # A Category 1 tile and its eight neighbours: ~45 M ground points.
        self.assertEqual(tin_workers(8, 45_000_000, 16 * gib), 1)
        self.assertEqual(tin_workers(8, 5_000_000, 16 * gib), 8)
        self.assertEqual(tin_workers(8, 5_000_000, 4 * gib), 2)

    def test_refused_only_when_one_job_alone_wont_fit(self):
        bpp = sharpen_module.TIN_BYTES_PER_POINT
        gib = 2**30
        # 55 M points need 11.55 GB: over the pool's 70 % of 15 GiB, under all of it.
        self.assertEqual(tin_workers(8, 55_000_000, 15 * gib), 1)
        self.assertEqual(tin_workers(8, 1000, 1000 * bpp), 1)
        with self.assertRaises(CannotSharpen) as ctx:
            tin_workers(8, 1001, 1000 * bpp)
        from worker_common import TOO_BIG

        self.assertEqual(str(ctx.exception), TOO_BIG)
        with self.assertRaises(CannotSharpen):
            tin_workers(8, 1, 0)

    def write(self, root, files):
        for name, text in files.items():
            (root / name).write_text(text)

    def test_free_memory(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            meminfo = root / "meminfo"
            meminfo.write_text("MemTotal: 16000000 kB\nMemAvailable: 10000000 kB\n")
            cgroup = root / "cg"
            cgroup.mkdir()
            free = sharpen_module.available_memory(meminfo, cgroup)
            self.assertEqual(free, 10_000_000 * 1024)  # no cgroup files: the host's
            self.write(cgroup, {"memory.max": "max\n"})
            self.assertEqual(sharpen_module.available_memory(meminfo, cgroup), free)
            # A 4 GiB limit, 3 GiB charged of which 2 GiB is page cache.
            self.write(
                cgroup,
                {
                    "memory.max": f"{4 * 2**30}\n",
                    "memory.current": f"{3 * 2**30}\n",
                    "memory.stat": f"anon 1\ninactive_file {2 * 2**30}\n",
                },
            )
            self.assertEqual(
                sharpen_module.available_memory(meminfo, cgroup), 3 * 2**30
            )
            self.write(cgroup, {"memory.current": f"{9 * 2**30}\n"})
            self.assertEqual(sharpen_module.available_memory(meminfo, cgroup), 0)


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
