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


@unittest.skipUnless(_IMPORT_OK, f"import failed: {globals().get('_IMPORT_ERR', '?')}")
class TestRenderTileJob(unittest.TestCase):
    """Red if the tile goes back to Pillow's `optimize` (level 9), which was
    most of the time a tile took to write."""

    def test_a_tile_is_written_at_the_vegetation_png_level(self):
        import io
        from unittest import mock

        import pipeline
        from PIL import Image

        density = np.random.default_rng(3).random((256, 256)).astype(np.float32)
        cfg = pipeline.RenderConfig(
            density_path="d.tif",
            output_dir=".",
            lon_min=0,
            lat_min=0,
            lon_max=1,
            lat_max=1,
        )
        with mock.patch.object(pipeline, "read_raster_window", return_value=density):
            *_, tile = pipeline.render_tile_job((14, 1, 2, cfg.__dict__.copy()))
        png = tile["vegetation"]
        image = Image.open(io.BytesIO(png))

        def encoded(**how):
            out = io.BytesIO()
            image.save(out, format="PNG", **how)
            return out.getvalue()

        self.assertEqual(png, encoded(compress_level=pipeline.VEGETATION_PNG_LEVEL))
        # The premise: on this tile the two settings' bytes differ.
        self.assertNotEqual(png, encoded(optimize=True))


if __name__ == "__main__":
    unittest.main()
