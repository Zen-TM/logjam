"""Per-layer tile rendering: numpy array → RGBA PIL image (pure, no GDAL)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import _native_stub  # noqa: F401,E402

try:
    import numpy as np  # noqa: E402
    from topo_mbtiles import (  # noqa: E402
        TILE_SIZE,
        render_hillshade_tile,
        render_slope_tile,
        render_vegetation_tile,
    )
    _IMPORT_OK = True
except Exception as _exc:  # noqa: BLE001
    _IMPORT_OK = False
    _IMPORT_ERR = _exc


@unittest.skipUnless(_IMPORT_OK, f"import failed: {globals().get('_IMPORT_ERR', '?')}")
class TestRenderHillshade(unittest.TestCase):
    def test_none_input_is_transparent(self):
        arr = np.array(render_hillshade_tile(None, {}))
        self.assertEqual(arr.shape, (TILE_SIZE, TILE_SIZE, 4))
        self.assertEqual(int(arr[..., 3].max()), 0)

    def test_white_tint_is_identity_luminance(self):
        hs = np.full((TILE_SIZE, TILE_SIZE), 128.0)
        out = np.array(render_hillshade_tile(hs, {"hillshade": {"colour": "#ffffffff"}}))
        self.assertEqual(int(out[0, 0, 0]), 128)
        self.assertEqual(int(out[0, 0, 1]), 128)
        self.assertEqual(int(out[0, 0, 2]), 128)
        self.assertEqual(int(out[0, 0, 3]), 255)

    def test_tint_colour_scales_channels(self):
        hs = np.full((TILE_SIZE, TILE_SIZE), 255.0)
        # Half-red tint, alpha 128.
        out = np.array(render_hillshade_tile(hs, {"hillshade": {"colour": "#80000080"}}))
        self.assertEqual(int(out[0, 0, 0]), 128)  # 255 * 0x80/255
        self.assertEqual(int(out[0, 0, 1]), 0)
        self.assertEqual(int(out[0, 0, 3]), 128)

    def test_nan_pixels_are_transparent(self):
        hs = np.full((TILE_SIZE, TILE_SIZE), 200.0)
        hs[0, 0] = np.nan
        out = np.array(render_hillshade_tile(hs, {"hillshade": {"colour": "#ffffffff"}}))
        self.assertEqual(int(out[0, 0, 3]), 0)
        self.assertEqual(int(out[1, 1, 3]), 255)


@unittest.skipUnless(_IMPORT_OK, f"import failed: {globals().get('_IMPORT_ERR', '?')}")
class TestRenderVegetation(unittest.TestCase):
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

    def test_none_input_is_transparent(self):
        out = np.array(render_vegetation_tile(None, self.SETTINGS))
        self.assertEqual(int(out[..., 3].max()), 0)

    def test_below_min_ratio_is_transparent(self):
        dens = np.full((TILE_SIZE, TILE_SIZE), 0.05)
        out = np.array(render_vegetation_tile(dens, self.SETTINGS))
        self.assertEqual(int(out[..., 3].max()), 0)

    def test_at_min_ratio_uses_sparse_colour_and_alpha_min(self):
        dens = np.full((TILE_SIZE, TILE_SIZE), 0.1)
        out = np.array(render_vegetation_tile(dens, self.SETTINGS))
        # t = sqrt(0) = 0 → sparse colour (#00ff00), alpha = alphaMin.
        self.assertEqual(int(out[0, 0, 0]), 0)
        self.assertEqual(int(out[0, 0, 1]), 255)
        self.assertEqual(int(out[0, 0, 3]), 50)

    def test_at_max_ratio_uses_dense_colour_and_alpha_max(self):
        dens = np.full((TILE_SIZE, TILE_SIZE), 0.9)
        out = np.array(render_vegetation_tile(dens, self.SETTINGS))
        # t = sqrt(1) = 1 → dense colour (#ff0000), alpha = alphaMax.
        self.assertEqual(int(out[0, 0, 0]), 255)
        self.assertEqual(int(out[0, 0, 1]), 0)
        self.assertEqual(int(out[0, 0, 3]), 200)


@unittest.skipUnless(_IMPORT_OK, f"import failed: {globals().get('_IMPORT_ERR', '?')}")
class TestRenderSlope(unittest.TestCase):
    SETTINGS = {
        "slope": {
            "bands": [
                {"fromDeg": 40, "toDeg": 60, "colour": "#ff000080"},
                {"fromDeg": 60, "toDeg": 90, "colour": "#0000ffff"},
            ]
        }
    }

    def test_none_input_is_transparent(self):
        out = np.array(render_slope_tile(None, self.SETTINGS))
        self.assertEqual(int(out[..., 3].max()), 0)

    def test_pixel_in_first_band(self):
        slope = np.full((TILE_SIZE, TILE_SIZE), 50.0)
        out = np.array(render_slope_tile(slope, self.SETTINGS))
        self.assertEqual(tuple(int(v) for v in out[0, 0]), (255, 0, 0, 128))

    def test_band_edges_are_half_open(self):
        # 60.0 belongs to the second band (>= 60), not the first (< 60).
        slope = np.full((TILE_SIZE, TILE_SIZE), 60.0)
        out = np.array(render_slope_tile(slope, self.SETTINGS))
        self.assertEqual(tuple(int(v) for v in out[0, 0]), (0, 0, 255, 255))

    def test_below_all_bands_is_transparent(self):
        slope = np.full((TILE_SIZE, TILE_SIZE), 10.0)
        out = np.array(render_slope_tile(slope, self.SETTINGS))
        self.assertEqual(int(out[..., 3].max()), 0)


if __name__ == "__main__":
    unittest.main()
