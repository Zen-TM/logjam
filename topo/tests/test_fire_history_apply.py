"""Unit tests for the job-time fire-history "stale-LiDAR" consumer.

Covers only the pure logic in pipeline.py:
  - _capture_year_from_las_files: ELVIS filename → capture year parsing.
  - _compute_stale_mask: per-cell "fire happened after LiDAR capture" mask.

Both are plain regex/numpy — no GDAL touched — but pipeline.py imports osgeo
at module top, so we stub it first (per topo/tests/_native_stub.py
convention) to keep this suite runnable on a host without GDAL Python
bindings. numpy is real (only osgeo/etc are stubbed when absent).

apply_fire_history itself (the GDAL warp + file-writing wrapper) is NOT
exercised here — it mirrors svtm_formation_aligned's warp block, which is only
integration-tested against real GDAL. This suite is intentionally scoped to
the pure pre/post logic around that warp.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import _native_stub  # noqa: F401,E402

import numpy as np  # noqa: E402
from pipeline import (  # noqa: E402
    _capture_year_from_las_files,
    _compute_stale_mask,
    _fire_stale_summary,
)


class TestCaptureYearFromLasFiles(unittest.TestCase):
    def test_katoomba_202107_lid1(self):
        self.assertEqual(
            _capture_year_from_las_files(
                ["Katoomba202107-LID1-C3-AHD_5556425_56_0002_0002.laz"]
            ),
            2021,
        )

    def test_katoomba_201804_lid1(self):
        self.assertEqual(
            _capture_year_from_las_files(
                ["Katoomba201804-LID1-C3-AHD_5556425_56_0002_0002.laz"]
            ),
            2018,
        )

    def test_mossvale_201805_lid2(self):
        self.assertEqual(
            _capture_year_from_las_files(
                ["MossVale201805-LID2-C3-AHD_6666425_56_0003_0003.laz"]
            ),
            2018,
        )

    def test_mountpomany_201705_lid1(self):
        self.assertEqual(
            _capture_year_from_las_files(
                ["MountPomany201705-LID1-C3-AHD_7776425_56_0004_0004.laz"]
            ),
            2017,
        )

    def test_kiama_201610_lid2(self):
        self.assertEqual(
            _capture_year_from_las_files(
                ["Kiama201610-LID2-C3-AHD_8886425_56_0005_0005.laz"]
            ),
            2016,
        )

    def test_mixed_years_returns_minimum(self):
        # Most conservative choice: a cell is stale if ANY contributing
        # capture predates the fire, so the earliest capture year wins.
        files = [
            "Katoomba202107-LID1-C3-AHD_5556425_56_0002_0002.laz",
            "Katoomba201804-LID1-C3-AHD_5556425_56_0001_0001.laz",
            "MossVale201805-LID2-C3-AHD_6666425_56_0003_0003.laz",
        ]
        self.assertEqual(_capture_year_from_las_files(files), 2018)

    def test_unparseable_filename_returns_none(self):
        self.assertIsNone(
            _capture_year_from_las_files(["some_unrelated_pointcloud.laz"])
        )

    def test_empty_list_returns_none(self):
        self.assertIsNone(_capture_year_from_las_files([]))

    def test_full_path_is_handled_via_basename(self):
        self.assertEqual(
            _capture_year_from_las_files(
                ["/work/extracted/Kiama201610-LID2-C3-AHD_8886425_56_0005_0005.laz"]
            ),
            2016,
        )

    def test_list_with_one_unparseable_and_one_parseable_ignores_unparseable(self):
        files = [
            "some_unrelated_pointcloud.laz",
            "Kiama201610-LID2-C3-AHD_8886425_56_0005_0005.laz",
        ]
        self.assertEqual(_capture_year_from_las_files(files), 2016)


class TestComputeStaleMask(unittest.TestCase):
    def test_fire_after_capture_and_valid_is_stale(self):
        fire_year = np.array([[2022]], dtype=np.uint16)
        valid = np.array([[True]])
        stale_mask, stale_fraction = _compute_stale_mask(fire_year, 2018, valid)
        self.assertTrue(stale_mask[0, 0])
        self.assertEqual(stale_fraction, 1.0)

    def test_fire_year_zero_nodata_is_not_stale(self):
        # 0 = never-burned or no usable date on record — must not compare as
        # if it were a real (very old) year.
        fire_year = np.array([[0]], dtype=np.uint16)
        valid = np.array([[True]])
        stale_mask, stale_fraction = _compute_stale_mask(fire_year, 2018, valid)
        self.assertFalse(stale_mask[0, 0])
        self.assertEqual(stale_fraction, 0.0)

    def test_fire_before_or_equal_capture_is_not_stale(self):
        fire_year = np.array([[2018, 2010]], dtype=np.uint16)
        valid = np.array([[True, True]])
        stale_mask, stale_fraction = _compute_stale_mask(fire_year, 2018, valid)
        np.testing.assert_array_equal(stale_mask, [[False, False]])
        self.assertEqual(stale_fraction, 0.0)

    def test_invalid_cell_never_counted_stale_even_if_fire_is_later(self):
        # Cell would otherwise qualify as stale (fire after capture) but its
        # density is nodata (nan) — valid_mask excludes it.
        fire_year = np.array([[2022]], dtype=np.uint16)
        valid = np.array([[False]])
        stale_mask, stale_fraction = _compute_stale_mask(fire_year, 2018, valid)
        self.assertFalse(stale_mask[0, 0])
        self.assertEqual(stale_fraction, 0.0)

    def test_fraction_arithmetic_over_mixed_grid(self):
        # 2x2 grid: one stale, one not-stale-but-valid, one nodata-fire,
        # one invalid (excluded from the denominator entirely).
        fire_year = np.array([[2022, 2010], [0, 2022]], dtype=np.uint16)
        valid = np.array([[True, True], [True, False]])
        stale_mask, stale_fraction = _compute_stale_mask(fire_year, 2018, valid)
        np.testing.assert_array_equal(stale_mask, [[True, False], [False, False]])
        # 1 stale cell out of 3 valid cells.
        self.assertAlmostEqual(stale_fraction, 1.0 / 3.0)

    def test_no_valid_cells_does_not_divide_by_zero(self):
        fire_year = np.array([[2022]], dtype=np.uint16)
        valid = np.array([[False]])
        # max(valid_mask.sum(), 1) guards the denominator.
        _, stale_fraction = _compute_stale_mask(fire_year, 2018, valid)
        self.assertEqual(stale_fraction, 0.0)


class TestFireStaleSummary(unittest.TestCase):
    """The summary is counted over blocks of the area. Red if a block's counts
    replace the last block's and are not added to them, the first or last
    fire year is taken from one block only, or a block with no fire in it
    resets them."""

    def setUp(self):
        rng = np.random.default_rng(8)
        self.fire_year = rng.choice(
            np.array([0, 0, 2003, 2013, 2019, 2020], dtype=np.uint16), (40, 30)
        )
        self.fire_year[10:20] = 0  # rows with no fire on record
        self.fire_year[25, 3] = 1994
        self.fire_year[2, 7] = 2023
        self.valid = rng.random((40, 30)) > 0.3

    def blocks(self, rows):
        return (
            (self.fire_year[top : top + rows], self.valid[top : top + rows])
            for top in range(0, 40, rows)
        )

    def test_it_is_the_whole_area_s_whatever_blocks_it_is_counted_in(self):
        _, fraction = _compute_stale_mask(self.fire_year, 2018, self.valid)
        whole = {
            "capture_year": 2018,
            "stale_fraction": fraction,
            "fire_years_min": 1994,
            "fire_years_max": 2023,
        }
        self.assertTrue(0 < fraction < 1)
        for rows in (1, 7, 16, 40):
            self.assertEqual(_fire_stale_summary(self.blocks(rows), 2018), whole)

    def test_an_area_with_no_fire_on_record_has_no_fire_years(self):
        none = [(np.zeros((3, 3), np.uint16), np.ones((3, 3), bool))]
        self.assertEqual(
            _fire_stale_summary(none, 2018),
            {
                "capture_year": 2018,
                "stale_fraction": 0.0,
                "fire_years_min": None,
                "fire_years_max": None,
            },
        )


if __name__ == "__main__":
    unittest.main()
