"""Unit tests for the two-strata scrub combine and density-normalized
confidence-mask threshold.

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
    _bilateral_filter_weighted,
    _combine_scrub_strata,
    _density_normalized_min_pulses,
    _positive_median,
    _scrub_density_strips,
    _window_sums,
)


class TestBilateralBands(unittest.TestCase):
    """The filter works a band of rows at a time, on several threads. Red if
    a band reads the rows of another (its offset dropped), stops short of
    its neighbours' rows at its edge, or leaves the last, short band out."""

    def test_a_pixel_is_the_same_whatever_band_it_falls_in(self):
        from unittest import mock

        import pipeline

        rng = np.random.default_rng(7)
        value = rng.random((45, 31)).astype(np.float32)
        confidence = rng.integers(0, 6, (45, 31)).astype(np.float32)
        confidence[10:14, 5:9] = 0  # a hole: no pulse to weigh by

        def run(rows, workers):
            with mock.patch.object(pipeline, "BILATERAL_BAND_ROWS", rows):
                return _bilateral_filter_weighted(
                    value, confidence, 9, 3.0, 0.15, workers=workers
                )

        whole = run(10**6, 1)
        self.assertTrue(np.isfinite(whole).any())
        for rows in (1, 7, 45):
            np.testing.assert_array_equal(run(rows, 3), whole)

    def test_a_cell_with_no_pulse_near_it_has_no_value(self):
        value = np.full((12, 12), 0.5, np.float32)
        confidence = np.zeros((12, 12), np.float32)
        confidence[0, 0] = 1
        out = _bilateral_filter_weighted(value, confidence, 9, 3.0, 0.15)
        self.assertEqual(out[0, 0], np.float32(0.5))
        self.assertTrue(np.isnan(out[11, 11]))


class TestWindowSums(unittest.TestCase):
    """Red if a row's sum is carried into the next (one running sum for the
    whole block), a window is a row or column off, a band of rows is summed
    from the first band's rows, or the sums are worked in float32: counts of
    pulses add up exactly."""

    def test_a_window_s_sum_is_the_sum_of_its_cells(self):
        rng = np.random.default_rng(11)
        k = 5
        padded = rng.integers(0, 9, (75, 21)).astype(np.float32)  # two bands of rows
        padded[3, 4] = 2.0**25  # a float32 running sum would lose the 1s after it
        want = np.array(
            [
                [padded[i : i + k, j : j + k].sum(dtype=np.float64) for j in range(17)]
                for i in range(71)
            ]
        ).astype(np.float32)
        np.testing.assert_array_equal(_window_sums(padded, k), want)

    def test_a_cell_is_the_same_whatever_rows_it_is_worked_with(self):
        rng = np.random.default_rng(12)
        k = 9
        padded = (rng.random((40, 30)) * 7).astype(np.float32)  # not whole numbers
        whole = _window_sums(padded, k)
        for rows in (1, 5, 32):
            parts = [
                _window_sums(padded[top : top + rows + k - 1], k)
                for top in range(0, 32, rows)
            ]
            np.testing.assert_array_equal(np.vstack(parts), whole)


class TestPositiveMedian(unittest.TestCase):
    """Red if the middle is taken of every value (not only the positive
    ones), the two middle values of an even count are not averaged, a block
    after the first is not counted, or the low halves of values with another
    high half are counted in."""

    def test_it_is_numpy_s_median_of_the_positive_values(self):
        rng = np.random.default_rng(3)
        for n in (1, 2, 3, 10, 1001, 30000, 30001):
            for kind in range(4):
                a = (rng.random(n) * 10.0 ** rng.integers(-3, 4)).astype(np.float32)
                if kind == 1:
                    a = np.round(a)  # ties, and cells with no return
                if kind == 2:
                    a[: n // 2] = -1.0
                if kind == 3:
                    a[:] = 2.5
                positive = a[a > 0]
                want = float(np.median(positive)) if positive.size else None
                for rows in (1 + n // 7, n):
                    got = _positive_median(
                        lambda: (a[i : i + rows] for i in range(0, n, rows))
                    )
                    self.assertEqual(got, want, (n, kind, rows))

    def test_no_positive_value_is_no_median(self):
        self.assertIsNone(_positive_median(lambda: [np.zeros(5, np.float32)]))
        self.assertIsNone(_positive_median(lambda: []))


class TestDensityStrips(unittest.TestCase):
    """The density is worked a strip of rows at a time, over the columns that
    have a pulse near them. Red if a strip is worked without its neighbours'
    rows (a seam at each strip's edge), the rows beyond the grid's edge are
    not reflected, the last, short strip is left out, or the columns are cut
    closer to the pulses than their windows reach."""

    def setUp(self):
        rng = np.random.default_rng(21)
        self.h, self.w = 70, 90
        self.low, self.high, self.below = (
            rng.integers(0, 4, (self.h, self.w)).astype(np.float32) for _ in range(3)
        )

    def counts(self, first, end):
        return self.low[first:end], self.high[first:end], self.below[first:end]

    def density(self, rows, threshold=365.0):
        strips = list(
            _scrub_density_strips(self.counts, self.h, self.w, rows, threshold, 2)
        )
        self.assertEqual([top for top, _ in strips], list(range(0, self.h, rows)))
        return np.vstack([d for _, d in strips])

    def whole(self, threshold=365.0):
        # The same arithmetic on the whole grid at once.
        from pipeline import (
            SCRUB_DENSITY_FILTER_WINDOW_M as k,
            SCRUB_DENSITY_SIGMA_RANGE,
            SCRUB_DENSITY_SIGMA_SPATIAL_M,
        )

        total, raw = _combine_scrub_strata(
            self.low,
            self.high,
            self.below,
            SCRUB_STRATUM_WEIGHT_LOW,
            SCRUB_STRATUM_WEIGHT_HIGH,
        )
        smoothed = _bilateral_filter_weighted(
            raw, total, k, SCRUB_DENSITY_SIGMA_SPATIAL_M, SCRUB_DENSITY_SIGMA_RANGE
        )
        windowed = _window_sums(np.pad(total, k // 2, mode="reflect"), k)
        smoothed[~((windowed >= threshold) & np.isfinite(smoothed))] = np.nan
        return smoothed

    def test_a_cell_is_the_same_whatever_strip_it_falls_in(self):
        whole = self.whole()
        self.assertTrue(np.isfinite(whole).any() and np.isnan(whole).any())
        for rows in (1, 3, 16, 70, 500):
            np.testing.assert_array_equal(self.density(rows), whole)

    def test_ground_with_no_pulse_is_left_out_of_the_work_and_has_no_density(self):
        # Pulses in one block of columns in the top rows and another lower
        # down, as tiles that do not form a rectangle leave them.
        for counts in (self.low, self.high, self.below):
            counts[:40, 30:] = 0
            counts[40:, :55] = 0
            counts[60:] = 0
        whole = self.whole(threshold=5.0)
        self.assertTrue(np.isfinite(whole[:40, :30]).any())
        self.assertTrue(np.isnan(whole[:36, 40:]).all())
        for rows in (4, 16, 70):
            np.testing.assert_array_equal(self.density(rows, 5.0), whole)


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
        # so raw_nrd (weighted_scrub / total_near) can never exceed the
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
            np.array([18.0]),
            np.array([2.0]),
            np.array([0.0]),
        )
        high_heavy_low, high_heavy_high, high_heavy_below = (
            np.array([2.0]),
            np.array([18.0]),
            np.array([0.0]),
        )

        _, low_heavy_nrd = _combine_scrub_strata(
            low_heavy_low,
            low_heavy_high,
            low_heavy_below,
            SCRUB_STRATUM_WEIGHT_LOW,
            SCRUB_STRATUM_WEIGHT_HIGH,
        )
        _, high_heavy_nrd = _combine_scrub_strata(
            high_heavy_low,
            high_heavy_high,
            high_heavy_below,
            SCRUB_STRATUM_WEIGHT_LOW,
            SCRUB_STRATUM_WEIGHT_HIGH,
        )

        self.assertGreater(high_heavy_nrd[0], low_heavy_nrd[0])

    def test_equal_weights_reproduce_old_unweighted_nrd(self):
        # With both weights set to 1.0, the combine collapses to the
        # unweighted NRD = (scrub_count) / (scrub_count + below_count), where
        # scrub_count = low + high.
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
            _positive_median(lambda: [sparse_all]),
            SCRUB_DENSITY_REFERENCE_ALL_RETURNS,
            SCRUB_DENSITY_MIN_PULSES,
        )
        self.assertAlmostEqual(nominal_all, 0.5)
        self.assertAlmostEqual(scale, 0.5)  # clamped floor
        self.assertAlmostEqual(min_pulses_eff, SCRUB_DENSITY_MIN_PULSES * 0.5)

    def test_dense_capture_scales_threshold_toward_upper_clamp(self):
        # nominal_all well above the reference → scale should clamp toward
        # the 2.0x ceiling.
        dense_all = np.full((10, 10), 50.0, dtype=np.float32)  # >> reference (4.0)
        nominal_all, scale, min_pulses_eff = _density_normalized_min_pulses(
            _positive_median(lambda: [dense_all]),
            SCRUB_DENSITY_REFERENCE_ALL_RETURNS,
            SCRUB_DENSITY_MIN_PULSES,
        )
        self.assertAlmostEqual(nominal_all, 50.0)
        self.assertAlmostEqual(scale, 2.0)  # clamped ceiling
        self.assertAlmostEqual(min_pulses_eff, SCRUB_DENSITY_MIN_PULSES * 2.0)

    def test_nominal_density_at_reference_yields_scale_one(self):
        at_reference = np.full(
            (10, 10), SCRUB_DENSITY_REFERENCE_ALL_RETURNS, dtype=np.float32
        )
        nominal_all, scale, min_pulses_eff = _density_normalized_min_pulses(
            _positive_median(lambda: [at_reference]),
            SCRUB_DENSITY_REFERENCE_ALL_RETURNS,
            SCRUB_DENSITY_MIN_PULSES,
        )
        self.assertAlmostEqual(nominal_all, SCRUB_DENSITY_REFERENCE_ALL_RETURNS)
        self.assertAlmostEqual(scale, 1.0)
        self.assertAlmostEqual(min_pulses_eff, SCRUB_DENSITY_MIN_PULSES)

    def test_no_positive_cells_falls_back_to_reference_without_dividing_by_zero(self):
        all_zero = np.zeros((5, 5), dtype=np.float32)
        nominal_all, scale, min_pulses_eff = _density_normalized_min_pulses(
            _positive_median(lambda: [all_zero]),
            SCRUB_DENSITY_REFERENCE_ALL_RETURNS,
            SCRUB_DENSITY_MIN_PULSES,
        )
        self.assertAlmostEqual(nominal_all, SCRUB_DENSITY_REFERENCE_ALL_RETURNS)
        self.assertAlmostEqual(scale, 1.0)
        self.assertAlmostEqual(min_pulses_eff, SCRUB_DENSITY_MIN_PULSES)


if __name__ == "__main__":
    unittest.main()
