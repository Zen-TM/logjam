"""Contour DEM smoothing — pure-numpy Gaussian low-pass (host-runnable).

We smooth the surface, not the lines: contours of a smoothed DEM are level sets
of a continuous field and so cannot cross (the property per-line simplification
can't guarantee on cliffs). The GDAL raster I/O wrapper `smooth_dem_for_contours`
runs in the worker image; here we test the array math that gives that property."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import _native_stub  # noqa: F401,E402

import numpy as np  # noqa: E402
from pipeline import _gaussian_blur_2d, _normalized_gaussian  # noqa: E402


class TestGaussianBlur2d(unittest.TestCase):
    def test_constant_field_unchanged(self):
        a = np.full((20, 20), 7.0)
        np.testing.assert_allclose(_gaussian_blur_2d(a, 2.0), 7.0, atol=1e-9)

    def test_preserves_shape(self):
        a = np.random.default_rng(0).normal(size=(31, 17))
        self.assertEqual(_gaussian_blur_2d(a, 1.5).shape, a.shape)

    def test_reduces_variance(self):
        a = np.random.default_rng(1).normal(size=(40, 40))
        self.assertLess(_gaussian_blur_2d(a, 2.0).var(), a.var())

    def test_zero_sigma_is_identity(self):
        a = np.random.default_rng(2).normal(size=(10, 10))
        np.testing.assert_array_equal(_gaussian_blur_2d(a, 0.0), a)

    def test_roughly_preserves_mean(self):
        # A normalized kernel conserves the field's average up to small edge
        # effects from reflect padding (not exact, but no systematic drift).
        a = np.random.default_rng(3).normal(5.0, 2.0, size=(50, 50))
        self.assertAlmostEqual(_gaussian_blur_2d(a, 3.0).mean(), a.mean(), delta=0.01)


class TestNormalizedGaussian(unittest.TestCase):
    def test_nodata_does_not_bleed(self):
        # A constant valid region beside a block of nodata sentinels: the smoothed
        # valid cells must stay ~constant, not get dragged toward -9999.
        arr = np.full((30, 30), 100.0)
        valid = np.ones((30, 30), dtype=bool)
        arr[:, :10] = -9999.0
        valid[:, :10] = False
        out = _normalized_gaussian(arr, valid, sigma_cells=3.0)
        np.testing.assert_allclose(out[valid], 100.0, atol=1e-6)

    def test_all_valid_matches_plain_blur(self):
        arr = np.random.default_rng(4).normal(size=(25, 25))
        valid = np.ones_like(arr, dtype=bool)
        np.testing.assert_allclose(
            _normalized_gaussian(arr, valid, 2.0), _gaussian_blur_2d(arr, 2.0), atol=1e-9
        )

    def test_monotonic_surface_stays_monotonic(self):
        # The crossing-free guarantee in practice: a strictly increasing surface
        # (plus noise) must stay monotonically increasing along its gradient after
        # smoothing, so its level-set contours keep their order and never cross.
        rng = np.random.default_rng(5)
        ramp = np.arange(60).astype(float)[None, :] * 3.0  # increases along columns
        surface = ramp + rng.normal(0.0, 0.4, size=(60, 60))
        valid = np.ones_like(surface, dtype=bool)
        smoothed = _normalized_gaussian(surface, valid, sigma_cells=3.0)
        # Interior columns (away from reflect-padded edges) strictly increase.
        diffs = np.diff(smoothed[:, 5:-5], axis=1)
        self.assertTrue(np.all(diffs > 0))


if __name__ == "__main__":
    unittest.main()
