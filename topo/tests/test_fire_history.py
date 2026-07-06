"""Unit tests for build_fire_history.resolve_fire_year — the pure date→year
mapping used to decide which NPWS Fire History polygons are rasterizable.

Pure stdlib logic — no GDAL/OGR — but build_fire_history.py imports osgeo at
module top, so we stub it first (per topo/tests/_native_stub.py convention)
to keep this suite runnable on a host without GDAL Python bindings.
"""
import os
import sys
import unittest
from datetime import date

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import _native_stub  # noqa: F401,E402  (stubs osgeo when absent on the host)

from build_fire_history import resolve_fire_year  # noqa: E402

_CURRENT_YEAR = 2026


class TestResolveFireYear(unittest.TestCase):
    def test_end_date_present_uses_end_date_year(self):
        self.assertEqual(
            resolve_fire_year(date(2019, 7, 1), date(2020, 3, 15), _CURRENT_YEAR),
            2020,
        )

    def test_end_date_null_falls_back_to_start_date_year(self):
        self.assertEqual(
            resolve_fire_year(date(2015, 11, 1), None, _CURRENT_YEAR),
            2015,
        )

    def test_both_dates_null_returns_none(self):
        self.assertIsNone(resolve_fire_year(None, None, _CURRENT_YEAR))

    def test_sentinel_1899_start_date_rejected(self):
        self.assertIsNone(resolve_fire_year(date(1899, 12, 30), None, _CURRENT_YEAR))

    def test_sentinel_1899_end_date_rejected(self):
        self.assertIsNone(resolve_fire_year(date(2007, 1, 1), date(1899, 12, 30), _CURRENT_YEAR))

    def test_bogus_1807_end_date_rejected_even_with_valid_start_date(self):
        # Real NPWS data quirk: StartDate=2007-07-18 but EndDate=1807-07-01.
        # EndDate is coalesced first, so the bogus year drops the feature
        # even though StartDate alone would have been valid.
        self.assertIsNone(resolve_fire_year(date(2007, 7, 18), date(1807, 7, 1), _CURRENT_YEAR))

    def test_future_year_rejected(self):
        future = date(_CURRENT_YEAR + 2, 1, 1)
        self.assertIsNone(resolve_fire_year(None, future, _CURRENT_YEAR))

    def test_normal_recent_year_accepted(self):
        self.assertEqual(
            resolve_fire_year(date(2019, 7, 1), date(2019, 12, 20), _CURRENT_YEAR),
            2019,
        )


if __name__ == "__main__":
    unittest.main()
