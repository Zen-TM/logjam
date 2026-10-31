"""Stale-fire fade drawn into the vegetation tile (pure numpy/PIL, no GDAL).

Covers render_vegetation_tile's stale_arr fade and _feather_stale, which
apply_fire_history runs once over the whole AOI before tiles are cut. The
raster write itself (GDAL warp) is integration-tested in
test_fire_history_apply.py. Same _native_stub convention as
test_render_tiles.py: pipeline.py imports osgeo at module top, so we stub it
first; numpy/PIL must be real since these tests do real array/image maths.
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
        FIRE_STALE_FADE_GREY,
        FIRE_STALE_WASH_ALPHA,
        _feather_stale,
        render_vegetation_tile,
    )

    _IMPORT_OK = True
except Exception as _exc:  # noqa: BLE001
    _IMPORT_OK = False
    _IMPORT_ERR = _exc

if _IMPORT_OK and (_native_stub.is_stubbed("numpy") or _native_stub.is_stubbed("PIL")):
    _IMPORT_OK = False
    _IMPORT_ERR = "numpy/PIL is stubbed on this host (real array/image maths required)"


@unittest.skipUnless(_IMPORT_OK, f"import failed: {globals().get('_IMPORT_ERR', '?')}")
class TestStaleFireFade(unittest.TestCase):
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

    def _full(self, v, dtype=np.float32):
        return np.full((TILE_SIZE, TILE_SIZE), v, dtype=dtype)

    def test_open_ground_gets_faint_neutral_wash(self):
        # Mutation: gate the wash on `mask` (visible density) -> transparent.
        out = np.array(
            render_vegetation_tile(self._full(0.0), self.SETTINGS, self._full(1.0))
        )
        self.assertTrue(np.all(out[..., 3] == FIRE_STALE_WASH_ALPHA))
        for ch in range(3):
            self.assertTrue(np.all(out[..., ch] == FIRE_STALE_FADE_GREY[ch]))

    def test_wash_scales_with_strength(self):
        out = np.array(
            render_vegetation_tile(self._full(0.0), self.SETTINGS, self._full(0.5))
        )
        self.assertEqual(out[0, 0, 3], FIRE_STALE_WASH_ALPHA // 2)

    def test_density_keeps_ramp_but_greyer_and_fainter(self):
        # Mutation: drop the blend or the alpha cut -> equal to the plain render.
        density = self._full(0.5)
        plain = np.array(render_vegetation_tile(density, self.SETTINGS)).astype(int)
        faded = np.array(
            render_vegetation_tile(density, self.SETTINGS, self._full(1.0))
        ).astype(int)
        self.assertLess(faded[0, 0, 3], plain[0, 0, 3])
        self.assertGreater(faded[0, 0, 3], FIRE_STALE_WASH_ALPHA)
        # Plain ramp is pure green/red; the fade moves every channel towards grey.
        grey = FIRE_STALE_FADE_GREY[0]
        for ch in range(3):
            self.assertLess(
                abs(faded[0, 0, ch] - grey), abs(plain[0, 0, ch] - grey) + 1
            )

    def test_denser_still_reads_darker_inside_burnt_ground(self):
        # Mutation: flatten the ramp under the fade (e.g. fixed colour) -> equal.
        strength = self._full(1.0)
        sparse = np.array(
            render_vegetation_tile(self._full(0.2), self.SETTINGS, strength)
        )[0, 0].astype(int)
        dense = np.array(
            render_vegetation_tile(self._full(0.9), self.SETTINGS, strength)
        )[0, 0].astype(int)
        self.assertGreater(dense[3], sparse[3])

    def test_stale_arr_none_is_byte_identical_to_no_stale_render(self):
        density = (
            np.random.RandomState(42)
            .uniform(0.0, 1.0, size=(TILE_SIZE, TILE_SIZE))
            .astype(np.float32)
        )
        np.testing.assert_array_equal(
            np.array(render_vegetation_tile(density, self.SETTINGS)),
            np.array(render_vegetation_tile(density, self.SETTINGS, None)),
        )

    def test_zero_strength_is_byte_identical_to_unburnt(self):
        density = self._full(0.5)
        np.testing.assert_array_equal(
            np.array(render_vegetation_tile(density, self.SETTINGS)),
            np.array(render_vegetation_tile(density, self.SETTINGS, self._full(0.0))),
        )

    def test_nan_strength_counts_as_unburnt(self):
        stale = self._full(1.0)
        stale[:, 100:] = np.nan
        out = np.array(render_vegetation_tile(self._full(0.0), self.SETTINGS, stale))
        self.assertTrue(np.all(out[:, 100:, 3] == 0))
        self.assertTrue(np.all(out[:, :100, 3] == FIRE_STALE_WASH_ALPHA))

    def test_mismatched_shape_skips_fade_without_crashing(self):
        density = self._full(0.5)
        wrong = np.ones((TILE_SIZE // 2, TILE_SIZE // 2), dtype=np.float32)
        np.testing.assert_array_equal(
            np.array(render_vegetation_tile(density, self.SETTINGS, wrong)),
            np.array(render_vegetation_tile(density, self.SETTINGS)),
        )

    def test_feathered_strength_has_no_seam(self):
        # A burnt edge lands exactly on the boundary of two adjacent tiles.
        # Guard: feathering runs once on the whole raster. Mutation: blur each
        # 256 px tile on its own (`_feather_stale(mask[:, :256])`) -> the
        # shared columns jump from 0 to 1 and this fails.
        mask = np.zeros((TILE_SIZE, 2 * TILE_SIZE), dtype=bool)
        mask[:, TILE_SIZE:] = True
        strength = _feather_stale(mask)
        left = np.array(
            render_vegetation_tile(
                self._full(0.0), self.SETTINGS, strength[:, :TILE_SIZE]
            )
        ).astype(int)
        right = np.array(
            render_vegetation_tile(
                self._full(0.0), self.SETTINGS, strength[:, TILE_SIZE:]
            )
        ).astype(int)
        seam = np.abs(left[:, -1, 3] - right[:, 0, 3]).max()
        interior = np.abs(np.diff(left[:, :, 3], axis=1)).max()
        self.assertLessEqual(seam, interior)
        # And the edge really is soft, not a 0 -> wash step.
        self.assertLess(interior, FIRE_STALE_WASH_ALPHA // 4)

    def test_feather_softens_edges_and_keeps_interior_and_aoi_edge(self):
        mask = np.zeros((200, 200), dtype=bool)
        mask[:, 100:] = True
        s = _feather_stale(mask)
        self.assertEqual(s.dtype, np.float32)
        self.assertTrue(0.0 < s[50, 99] < 1.0 and 0.0 < s[50, 101] < 1.0)
        self.assertEqual(s[50, 0], 0.0)
        self.assertEqual(s[50, 199], 1.0)  # AOI edge is not faded
        self.assertEqual(s.shape, mask.shape)

    def test_feather_leaves_nothing_where_nothing_burnt(self):
        self.assertFalse(_feather_stale(np.zeros((50, 50), dtype=bool)).any())


if __name__ == "__main__":
    unittest.main()
