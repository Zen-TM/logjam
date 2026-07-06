"""Stale-fire caution overlay drawn into the vegetation tile (pure numpy/PIL,
no GDAL).

Covers only render_vegetation_tile's stale_arr overlay logic — the fire_stale
raster itself is written by apply_fire_history (GDAL warp, integration-tested
separately, see test_fire_history_apply.py). Same _native_stub convention as
the rest of the render-tile test suite (test_render_tiles.py): pipeline.py
imports osgeo at module top, so we stub it first; numpy/PIL must be real
since these tests do real array/image maths.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import _native_stub  # noqa: F401,E402

try:
    import numpy as np  # noqa: E402
    from pipeline import (  # noqa: E402
        TILE_SIZE,
        FIRE_STALE_HATCH_COLOUR,
        FIRE_STALE_HATCH_ALPHA,
        render_vegetation_tile,
    )
    _IMPORT_OK = True
except Exception as _exc:  # noqa: BLE001
    _IMPORT_OK = False
    _IMPORT_ERR = _exc

# These tests do real array/image maths — a MagicMock numpy or PIL (lean host)
# would only produce nonsense. Same convention as test_render_tiles.py.
if _IMPORT_OK and (_native_stub.is_stubbed("numpy") or _native_stub.is_stubbed("PIL")):
    _IMPORT_OK = False
    _IMPORT_ERR = "numpy/PIL is stubbed on this host (real array/image maths required)"


@unittest.skipUnless(_IMPORT_OK, f"import failed: {globals().get('_IMPORT_ERR', '?')}")
class TestStaleFireHatchOverlay(unittest.TestCase):
    SETTINGS = {
        "vegetation": {
            "minRatio": 0.1,
            "maxRatio": 0.9,
            "sparseColour": "#00ff00ff",
            "denseColour": "#ff0000ff",
            "alphaMin": 50,
            "alphaMax": 200,
        }
    }

    def _amber_pixels(self, arr):
        """Boolean mask of pixels matching the caution-amber hatch colour
        (allow ±1 for uint8 rounding), independent of alpha."""
        r_ok = (arr[..., 0] >= FIRE_STALE_HATCH_COLOUR[0] - 1) & (arr[..., 0] <= FIRE_STALE_HATCH_COLOUR[0] + 1)
        g_ok = (arr[..., 1] >= FIRE_STALE_HATCH_COLOUR[1] - 1) & (arr[..., 1] <= FIRE_STALE_HATCH_COLOUR[1] + 1)
        b_ok = (arr[..., 2] >= FIRE_STALE_HATCH_COLOUR[2] - 1) & (arr[..., 2] <= FIRE_STALE_HATCH_COLOUR[2] + 1)
        return r_ok & g_ok & b_ok

    def test_all_stale_produces_amber_hatch_with_gaps(self):
        # Below minRatio everywhere, so without the overlay this tile would be
        # fully transparent — the hatch must still appear since it's independent
        # of density.
        density = np.zeros((TILE_SIZE, TILE_SIZE), dtype=np.float32)
        stale = np.ones((TILE_SIZE, TILE_SIZE), dtype=np.uint8)

        out = np.array(render_vegetation_tile(density, self.SETTINGS, stale))
        amber = self._amber_pixels(out)

        self.assertTrue(amber.any(), "expected some amber hatch pixels")
        # Cadence check: exactly 2 px in every 8 px diagonal period are amber,
        # i.e. the hatch is a stripe pattern, not a solid fill.
        self.assertFalse(amber.all(), "hatch must leave non-amber gaps, not solid-fill")
        amber_alpha = out[..., 3][amber]
        self.assertTrue(np.all(amber_alpha == FIRE_STALE_HATCH_ALPHA))

        # Exact expected fraction: stripe is 2 px wide out of an 8 px period.
        expected_fraction = 2.0 / 8.0
        actual_fraction = float(amber.sum()) / (TILE_SIZE * TILE_SIZE)
        self.assertAlmostEqual(actual_fraction, expected_fraction, places=2)

    def test_stale_arr_none_is_byte_identical_to_no_stale_render(self):
        # Fire-staleness detection disabled/unavailable for this job — the
        # overlay must be a pure no-op vs. never having the parameter at all.
        density = np.random.RandomState(42).uniform(0.0, 1.0, size=(TILE_SIZE, TILE_SIZE)).astype(np.float32)

        out_without_param = np.array(render_vegetation_tile(density, self.SETTINGS))
        out_with_none = np.array(render_vegetation_tile(density, self.SETTINGS, None))

        np.testing.assert_array_equal(out_without_param, out_with_none)

    def test_half_stale_confines_amber_to_stale_half(self):
        density = np.zeros((TILE_SIZE, TILE_SIZE), dtype=np.float32)
        stale = np.zeros((TILE_SIZE, TILE_SIZE), dtype=np.uint8)
        half = TILE_SIZE // 2
        stale[:, :half] = 1  # left half stale, right half not

        out = np.array(render_vegetation_tile(density, self.SETTINGS, stale))
        amber = self._amber_pixels(out)

        self.assertTrue(amber[:, :half].any(), "expected amber hatch in the stale half")
        self.assertFalse(amber[:, half:].any(), "no amber hatch expected outside the stale half")

    def test_mismatched_shape_skips_overlay_without_crashing(self):
        density = np.full((TILE_SIZE, TILE_SIZE), 0.5)  # mid-range, well above minRatio
        wrong_shape_stale = np.ones((TILE_SIZE // 2, TILE_SIZE // 2), dtype=np.uint8)

        out_with_mismatch = np.array(render_vegetation_tile(density, self.SETTINGS, wrong_shape_stale))
        out_without_stale = np.array(render_vegetation_tile(density, self.SETTINGS))

        # Defensive skip — no amber hatch, no crash, and density rendering
        # (unaffected by the skipped overlay) is identical to the no-stale render.
        amber = self._amber_pixels(out_with_mismatch)
        self.assertFalse(amber.any())
        np.testing.assert_array_equal(out_with_mismatch, out_without_stale)


if __name__ == "__main__":
    unittest.main()
