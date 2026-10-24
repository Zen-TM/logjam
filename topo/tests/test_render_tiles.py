"""Vegetation tile rendering: numpy array → RGBA PIL image (pure, no GDAL)."""

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
        render_vegetation_tile,
    )

    _IMPORT_OK = True
except Exception as _exc:  # noqa: BLE001
    _IMPORT_OK = False
    _IMPORT_ERR = _exc

# These tests do real array maths — a MagicMock numpy (lean host) would only
# produce nonsense. Same convention as the is_stubbed("osgeo") GDAL skips.
if _IMPORT_OK and _native_stub.is_stubbed("numpy"):
    _IMPORT_OK = False
    _IMPORT_ERR = "numpy is stubbed on this host (real array maths required)"


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


if __name__ == "__main__":
    unittest.main()
