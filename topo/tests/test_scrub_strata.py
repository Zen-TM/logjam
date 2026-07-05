"""Unit tests for the two-strata scrub combine (B.3) and density-normalized
confidence-mask threshold (B.2).

Covers only the pure arithmetic extracted from compute_rasters:
  - _combine_scrub_strata: weighted-strata NRD combine + shared UNSPLIT
    confidence denominator (total_near).
  - _density_normalized_min_pulses: scales SCRUB_DENSITY_MIN_PULSES by how a
    job's nominal all-return density compares to a fixed reference.

Neither touches GDAL — pure numpy — but pipeline.py imports osgeo at module
top, so we stub it first (per topo/tests/_native_stub.py convention) to keep
this suite runnable on a host without GDAL Python bindings.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import _native_stub  # noqa: F401,E402

import numpy as np  # noqa: E402
from pipeline import (  # noqa: E402
    SCRUB_DENSITY_MIN_PULSES,
    SCRUB_DENSITY_REFERENCE_ALL_RETURNS,
    SCRUB_STRATUM_WEIGHT_HIGH,
    SCRUB_STRATUM_WEIGHT_LOW,
    _combine_scrub_strata,
    _density_normalized_min_pulses,
)


class TestCombineScrubStrata(unittest.TestCase):
    def test_weighted_combine_stays_within_zero_one_and_at_most_total_near(self):
        rng = np.random.default_rng(42)
        low = rng.uniform(0, 20, size=(50, 50)).astype(np.float32)
        high = rng.uniform(0, 20, size=(50, 50)).astype(np.float32)
        below = rng.uniform(0, 20, size=(50, 50)).astype(np.float32)

        total_near, raw_nrd = _combine_scrub_strata(
            low, high, below, SCRUB_STRATUM_WEIGHT_LOW, SCRUB_STRATUM_WEIGHT_HIGH
        )

        np.testing.assert_allclose(total_near, low + high + below)
        self.assertTrue(np.all(raw_nrd >= 0.0))
        self.assertTrue(np.all(raw_nrd <= 1.0))
        # weighted_scrub <= low + high <= total_near whenever weights <= 1,
        # so raw_nrd (weighted_scrub / total_near) can never exceed the old,
        # unweighted (low+high)/total_near ratio.
        unweighted_nrd = np.where(
            total_near > 0, (low + high) / np.maximum(total_near, 1.0), 0.0
        )
        self.assertTrue(np.all(raw_nrd <= unweighted_nrd + 1e-6))

    def test_all_zero_total_near_yields_zero_nrd_not_nan(self):
        zeros = np.zeros((4, 4), dtype=np.float32)
        total_near, raw_nrd = _combine_scrub_strata(
            zeros, zeros, zeros, SCRUB_STRATUM_WEIGHT_LOW, SCRUB_STRATUM_WEIGHT_HIGH
        )
        np.testing.assert_array_equal(total_near, zeros)
        np.testing.assert_array_equal(raw_nrd, zeros)

    def test_high_stratum_heavy_cell_scores_higher_than_low_stratum_heavy_cell(self):
        # Two cells with identical total_near (20 near-ground returns each),
        # but one is dominated by the low (grass) stratum and the other by
        # the high (woody) stratum. The high-heavy cell should score higher
        # NRD given SCRUB_STRATUM_WEIGHT_HIGH > SCRUB_STRATUM_WEIGHT_LOW.
        low_heavy_low, low_heavy_high, low_heavy_below = (
            np.array([18.0]), np.array([2.0]), np.array([0.0])
        )
        high_heavy_low, high_heavy_high, high_heavy_below = (
            np.array([2.0]), np.array([18.0]), np.array([0.0])
        )

        _, low_heavy_nrd = _combine_scrub_strata(
            low_heavy_low, low_heavy_high, low_heavy_below,
            SCRUB_STRATUM_WEIGHT_LOW, SCRUB_STRATUM_WEIGHT_HIGH,
        )
        _, high_heavy_nrd = _combine_scrub_strata(
            high_heavy_low, high_heavy_high, high_heavy_below,
            SCRUB_STRATUM_WEIGHT_LOW, SCRUB_STRATUM_WEIGHT_HIGH,
        )

        self.assertGreater(high_heavy_nrd[0], low_heavy_nrd[0])

    def test_equal_weights_reproduce_old_unweighted_nrd(self):
        # With both weights forced to 1.0, the combine must collapse to the
        # pre-B.3 NRD = (scrub_count) / (scrub_count + below_count), where
        # scrub_count = low + high (i.e. the old single scrub band).
        rng = np.random.default_rng(7)
        low = rng.uniform(0, 20, size=(30, 30)).astype(np.float32)
        high = rng.uniform(0, 20, size=(30, 30)).astype(np.float32)
        below = rng.uniform(0, 20, size=(30, 30)).astype(np.float32)

        total_near, raw_nrd = _combine_scrub_strata(low, high, below, 1.0, 1.0)

        old_scrub_count = low + high
        old_total = old_scrub_count + below
        old_nrd = np.where(
            old_total > 0, old_scrub_count / np.maximum(old_total, 1.0), 0.0
        ).astype(np.float32)

        np.testing.assert_allclose(total_near, old_total)
        np.testing.assert_allclose(raw_nrd, old_nrd, rtol=1e-5)


class TestDensityNormalizedMinPulses(unittest.TestCase):
    def test_sparse_capture_scales_threshold_toward_lower_clamp(self):
        # nominal_all well below the reference → scale should clamp toward
        # the 0.5x floor (masks fewer sparse cells than an unscaled threshold
        # would).
        sparse_all = np.full((10, 10), 0.5, dtype=np.float32)  # << reference (4.0)
        nominal_all, scale, min_pulses_eff = _density_normalized_min_pulses(
            sparse_all, SCRUB_DENSITY_REFERENCE_ALL_RETURNS, SCRUB_DENSITY_MIN_PULSES
        )
        self.assertAlmostEqual(nominal_all, 0.5)
        self.assertAlmostEqual(scale, 0.5)  # clamped floor
        self.assertAlmostEqual(min_pulses_eff, SCRUB_DENSITY_MIN_PULSES * 0.5)

    def test_dense_capture_scales_threshold_toward_upper_clamp(self):
        # nominal_all well above the reference → scale should clamp toward
        # the 2.0x ceiling.
        dense_all = np.full((10, 10), 50.0, dtype=np.float32)  # >> reference (4.0)
        nominal_all, scale, min_pulses_eff = _density_normalized_min_pulses(
            dense_all, SCRUB_DENSITY_REFERENCE_ALL_RETURNS, SCRUB_DENSITY_MIN_PULSES
        )
        self.assertAlmostEqual(nominal_all, 50.0)
        self.assertAlmostEqual(scale, 2.0)  # clamped ceiling
        self.assertAlmostEqual(min_pulses_eff, SCRUB_DENSITY_MIN_PULSES * 2.0)

    def test_nominal_density_at_reference_yields_scale_one(self):
        at_reference = np.full((10, 10), SCRUB_DENSITY_REFERENCE_ALL_RETURNS, dtype=np.float32)
        nominal_all, scale, min_pulses_eff = _density_normalized_min_pulses(
            at_reference, SCRUB_DENSITY_REFERENCE_ALL_RETURNS, SCRUB_DENSITY_MIN_PULSES
        )
        self.assertAlmostEqual(nominal_all, SCRUB_DENSITY_REFERENCE_ALL_RETURNS)
        self.assertAlmostEqual(scale, 1.0)
        self.assertAlmostEqual(min_pulses_eff, SCRUB_DENSITY_MIN_PULSES)

    def test_no_positive_cells_falls_back_to_reference_without_dividing_by_zero(self):
        all_zero = np.zeros((5, 5), dtype=np.float32)
        nominal_all, scale, min_pulses_eff = _density_normalized_min_pulses(
            all_zero, SCRUB_DENSITY_REFERENCE_ALL_RETURNS, SCRUB_DENSITY_MIN_PULSES
        )
        self.assertAlmostEqual(nominal_all, SCRUB_DENSITY_REFERENCE_ALL_RETURNS)
        self.assertAlmostEqual(scale, 1.0)
        self.assertAlmostEqual(min_pulses_eff, SCRUB_DENSITY_MIN_PULSES)


if __name__ == "__main__":
    unittest.main()
