"""Amber marking of ground burnt since the survey, drawn into the vegetation tile
(pure numpy/PIL, no GDAL).

Covers render_vegetation_tile's stale_arr drawing and _encode_fire_stale, which
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
        FIRE_STALE_AMBER,
        FIRE_STALE_BAND_ALPHA,
        FIRE_STALE_STRIPE_ALPHA,
        FIRE_STALE_STRIPE_PERIOD,
        _encode_fire_stale,
        render_vegetation_tile,
    )

    _IMPORT_OK = True
except Exception as _exc:  # noqa: BLE001
    _IMPORT_OK = False
    _IMPORT_ERR = _exc

if _IMPORT_OK and (_native_stub.is_stubbed("numpy") or _native_stub.is_stubbed("PIL")):
    _IMPORT_OK = False
    _IMPORT_ERR = "numpy/PIL is stubbed on this host (real array/image maths required)"

CELL_M = 4.0  # coarse grid keeps the whole-raster blurs cheap in tests


@unittest.skipUnless(_IMPORT_OK, f"import failed: {globals().get('_IMPORT_ERR', '?')}")
class TestBurntGroundMarking(unittest.TestCase):
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

    def _render(self, density, stale=None):
        return np.array(render_vegetation_tile(density, self.SETTINGS, stale))

    def _density(self):
        return (
            np.random.RandomState(7)
            .uniform(0.0, 1.0, size=(TILE_SIZE, TILE_SIZE))
            .astype(np.float32)
        )

    def _stripe_q(self, shape):
        r, c = np.indices(shape)
        return (r + c) % FIRE_STALE_STRIPE_PERIOD

    def test_density_away_from_amber_is_byte_identical_to_unburnt(self):
        # Mutation: fade the ramp under burnt ground (scale `rgba[..., 3]` by
        # 0.6 for inside pixels in render_vegetation_tile) -> pixels differ.
        density = self._density()
        # Burnt right of column 128, band 30 px deep, then deep inside (v = 1).
        stale = np.zeros((TILE_SIZE, TILE_SIZE), dtype=np.float32)
        k = np.clip(1 - (np.arange(TILE_SIZE) - 128) / 30.0, 0, 1)
        stale[:, 128:] = 1 + k[128:]
        plain, marked = self._render(density), self._render(density, stale)
        q = self._stripe_q(plain.shape[:2])
        # Unburnt ground, or deep burnt ground between stripes (stripe reaches
        # 1.4 px each side of q == 0).
        untouched = (stale < 0.5) | ((stale == 1.0) & (q > 2) & (q < 30))
        self.assertGreater(untouched.sum(), 10000)
        np.testing.assert_array_equal(plain[untouched], marked[untouched])
        self.assertTrue((plain != marked).any())

    def test_stripes_join_across_a_tile_edge(self):
        # Mutation: set FIRE_STALE_STRIPE_PERIOD to 36 (does not divide 256) or
        # index stripes by a per-tile offset -> the 512 px picture disagrees.
        n = 2 * TILE_SIZE
        density = np.zeros((n, n), dtype=np.float32)
        burnt = np.ones((n, n), dtype=np.float32)
        tiles = [
            [
                self._render(
                    density[i : i + TILE_SIZE, j : j + TILE_SIZE],
                    burnt[i : i + TILE_SIZE, j : j + TILE_SIZE],
                )[..., 3]
                > 0
                for j in (0, TILE_SIZE)
            ]
            for i in (0, TILE_SIZE)
        ]
        P = FIRE_STALE_STRIPE_PERIOD
        q = self._stripe_q((n, n))
        # The pattern a single continuous picture would have.
        expect = np.clip(1 - np.minimum(q, P - q) / 1.4, 0, 1) > 0
        np.testing.assert_array_equal(np.block(tiles), expect)

    def test_tiles_sharing_a_boundary_agree_on_band_values(self):
        # The encoding must not depend on where a tile cut falls. Mutation:
        # make _box_blur work in 256 px blocks (or encode per tile) -> a seam at
        # a multiple of 256 that the shifted raster below does not have.
        mask = np.zeros((TILE_SIZE, 3 * TILE_SIZE), dtype=bool)
        mask[:, TILE_SIZE - 3 :] = True  # fire edge 3 px left of the first cut
        a = _encode_fire_stale(mask, np.ones_like(mask), CELL_M)
        shift = 100  # in B the same ground sits 100 px left, cut elsewhere
        b = _encode_fire_stale(mask[:, shift:], np.ones_like(mask[:, shift:]), CELL_M)
        # Away from either raster's own border the two agree exactly.
        lo, hi = shift + 80, 3 * TILE_SIZE - 80
        np.testing.assert_allclose(
            a[:, lo:hi], b[:, lo - shift : hi - shift], atol=1e-6
        )
        # And the shared columns of two adjacent tiles do not jump.
        self.assertLessEqual(
            np.abs(a[:, TILE_SIZE] - a[:, TILE_SIZE - 1]).max(),
            np.abs(np.diff(a, axis=1)).max() + 1e-6,
        )

    def test_edge_line_stands_out_from_the_band(self):
        # Mutation: drop the `line * FIRE_STALE_LINE_ALPHA` term -> the edge is
        # only as strong as the band.
        burnt = np.zeros((TILE_SIZE, TILE_SIZE), dtype=bool)
        burnt[:, 128:] = True
        enc = _encode_fire_stale(burnt, np.ones_like(burnt), 1.0)
        alpha = self._render(self._full(0.0), enc)[..., 3]
        edge = alpha[:, np.flatnonzero(enc[0] >= 0.5)[0]]
        self.assertGreater(edge.min(), FIRE_STALE_BAND_ALPHA + 40)

    def test_edge_line_does_not_depend_on_the_tile_cut(self):
        # A curved fire edge, rendered cut at 256 and at 128: 128 keeps the
        # stripes in phase, so any difference is the band or line. Mutation:
        # take the line from a per-tile gradient
        # (`np.gradient(np.where(inside, band, 1.0))`) -> pixels differ along
        # the cut.
        n = 2 * TILE_SIZE
        r, c = np.indices((TILE_SIZE, n))
        burnt = c > 256 + 60 * np.sin(r / 40.0)
        enc = _encode_fire_stale(burnt, np.ones_like(burnt), 1.0)
        zero = self._full(0.0)
        left = self._render(zero, enc[:, :TILE_SIZE])
        right = self._render(zero, enc[:, TILE_SIZE:])
        mid = self._render(zero, enc[:, 128 : 128 + TILE_SIZE])
        joined = np.concatenate([left, right], axis=1)
        np.testing.assert_array_equal(joined[:, 128 : 128 + TILE_SIZE], mid)

    def test_burnt_all_over_gets_stripes_and_no_band(self):
        # An area sharpened wholly inside a fire: the AOI edge is not a fire
        # edge. Mutation: zero-pad instead of edge-pad in _box_blur (mode="edge"
        # -> "constant") -> a band and line appear along the raster edge.
        ones = np.ones((300, 300), dtype=bool)
        enc = _encode_fire_stale(ones, ones, CELL_M)
        np.testing.assert_array_equal(enc, np.ones_like(enc))
        out = self._render(self._full(0.0), enc[:TILE_SIZE, :TILE_SIZE])
        P = FIRE_STALE_STRIPE_PERIOD
        q = self._stripe_q(out.shape[:2])
        centre = q == 0
        self.assertTrue(np.all(out[centre, 3] == FIRE_STALE_STRIPE_ALPHA))
        for ch in range(3):
            self.assertTrue(np.all(out[centre, ch] == FIRE_STALE_AMBER[ch]))
        self.assertTrue(np.all(out[q == P // 2, 3] == 0))  # nothing between stripes

    def test_survey_edge_inside_a_burn_has_no_band(self):
        # Burnt all over, but the survey (density) stops at column 150. The
        # survey edge is not a fire edge. Mutation: pass the data-gated mask as
        # burnt_mask (`burnt & valid`) to _encode_fire_stale -> a band and line
        # run along column 150.
        burnt = np.ones((300, 300), dtype=bool)
        valid = np.ones((300, 300), dtype=bool)
        valid[:, 150:] = False
        enc = _encode_fire_stale(burnt, valid, CELL_M)
        self.assertTrue(
            np.all(enc[:, :140] == 1.0)
        )  # stripes, no band, up to the strip
        self.assertTrue(np.all(enc[:, 160:] == 0.0))  # nothing drawn off the survey
        gated = _encode_fire_stale(burnt & valid, valid, CELL_M)
        self.assertTrue((gated[:, :150] > 1.0).any())  # what the mutation would do

    def test_small_density_holes_do_not_punch_gaps_in_the_encoding(self):
        # Mutation: clip with the raw mask (`valid_mask` instead of the blurred
        # `has_data` in _encode_fire_stale) -> zeros where density is NaN.
        burnt = np.ones((300, 300), dtype=bool)
        valid = np.ones((300, 300), dtype=bool)
        valid[100:103, 100:103] = False
        valid[200, :] = False
        enc = _encode_fire_stale(burnt, valid, CELL_M)
        np.testing.assert_array_equal(enc, np.ones_like(enc))

    def test_stripes_draw_on_a_tile_with_no_density(self):
        # Mutation: return early when no cell meets minRatio
        # (`if not mask.any(): return img`) -> transparent tile.
        out = self._render(self._full(0.0), self._full(1.0))
        self.assertTrue((out[..., 3] > 0).any())

    def test_encoding_range_and_unburnt(self):
        self.assertFalse(
            _encode_fire_stale(
                np.zeros((50, 50), dtype=bool), np.ones((50, 50), dtype=bool), CELL_M
            ).any()
        )
        mask = np.zeros((200, 200), dtype=bool)
        mask[:, 100:] = True
        enc = _encode_fire_stale(mask, np.ones_like(mask), 1.0)
        self.assertEqual(enc.dtype, np.float32)
        self.assertEqual(enc[50, 5], 0.0)
        self.assertGreater(enc[50, 101], 1.5)  # at the edge, near 2
        self.assertEqual(enc[50, 199], 1.0)  # deep, at the AOI edge: no band

    def test_stale_arr_none_is_byte_identical_to_no_stale_render(self):
        density = self._density()
        np.testing.assert_array_equal(
            np.array(render_vegetation_tile(density, self.SETTINGS)),
            self._render(density, None),
        )

    def test_zero_is_byte_identical_to_unburnt(self):
        density = self._density()
        np.testing.assert_array_equal(
            self._render(density), self._render(density, self._full(0.0))
        )

    def test_nan_counts_as_outside(self):
        stale = self._full(1.0)
        stale[:, 100:] = np.nan
        out = self._render(self._full(0.0), stale)
        self.assertTrue(np.all(out[:, 100:, 3] == 0))
        self.assertTrue((out[:, :100, 3] > 0).any())

    def test_mismatched_shape_skips_without_crashing(self):
        density = self._density()
        wrong = np.ones((TILE_SIZE // 2, TILE_SIZE // 2), dtype=np.float32)
        np.testing.assert_array_equal(
            self._render(density, wrong), self._render(density)
        )


if __name__ == "__main__":
    unittest.main()
