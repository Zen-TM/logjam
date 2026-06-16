"""Label placement + decluttering along polylines (pure geometry + PIL text)."""
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import _native_stub  # noqa: F401,E402

try:
    from PIL import Image, ImageDraw, ImageFont  # noqa: E402
    from topo_mbtiles import (  # noqa: E402
        LABEL_MIN_GAP_PX,
        TILE_SIZE,
        _point_at_distance,
        declutter_labels,
        label_font_size,
        line_label_anchors,
        lonlat_to_world_px,
        tile_label_box,
    )
    _IMPORT_OK = True
except Exception as _exc:  # noqa: BLE001
    _IMPORT_OK = False
    _IMPORT_ERR = _exc


@unittest.skipUnless(_IMPORT_OK, f"import failed: {globals().get('_IMPORT_ERR', '?')}")
class TestPointAtDistance(unittest.TestCase):
    def test_endpoints(self):
        pts = [(0.0, 0.0), (10.0, 0.0)]
        seg = [10.0]
        self.assertEqual(_point_at_distance(pts, seg, 0.0), (0.0, 0.0))
        self.assertEqual(_point_at_distance(pts, seg, 10.0), (10.0, 0.0))

    def test_midpoint_interpolation(self):
        pts = [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0)]
        seg = [10.0, 10.0]
        # 15 units in → 5 up the second segment.
        self.assertEqual(_point_at_distance(pts, seg, 15.0), (10.0, 5.0))

    def test_zero_length_segment_is_skipped(self):
        pts = [(0.0, 0.0), (0.0, 0.0), (10.0, 0.0)]
        seg = [0.0, 10.0]
        self.assertEqual(_point_at_distance(pts, seg, 5.0), (5.0, 0.0))


@unittest.skipUnless(_IMPORT_OK, f"import failed: {globals().get('_IMPORT_ERR', '?')}")
class TestLineLabelAnchors(unittest.TestCase):
    def test_too_few_points(self):
        self.assertEqual(line_label_anchors([(150.0, -33.0)], 16, 100), [])

    def test_short_line_gets_single_midpoint_anchor(self):
        # Two points a few metres apart at z18 are far shorter than spacing.
        coords = [(150.30000, -33.50000), (150.30005, -33.50000)]
        anchors = line_label_anchors(coords, 18, 550)
        self.assertEqual(len(anchors), 1)
        # The anchor sits at the arc-length midpoint in world pixels.
        a, b = (lonlat_to_world_px(*c, 18) for c in coords)
        self.assertAlmostEqual(anchors[0][0], (a[0] + b[0]) / 2, places=3)

    def test_long_line_gets_multiple_evenly_spaced_anchors(self):
        # A long line across many tiles at z18.
        coords = [(150.20, -33.50), (150.40, -33.50)]
        anchors = line_label_anchors(coords, 18, 550)
        self.assertGreater(len(anchors), 2)
        # Consecutive anchors are ~spacing_px apart (straight line case).
        gaps = [math.hypot(anchors[i + 1][0] - anchors[i][0], anchors[i + 1][1] - anchors[i][1])
                for i in range(len(anchors) - 1)]
        for g in gaps:
            self.assertAlmostEqual(g, 550, delta=1.0)

    def test_degenerate_zero_length_line(self):
        coords = [(150.0, -33.0), (150.0, -33.0)]
        self.assertEqual(line_label_anchors(coords, 16, 100), [])


@unittest.skipUnless(_IMPORT_OK, f"import failed: {globals().get('_IMPORT_ERR', '?')}")
class TestLabelFontSize(unittest.TestCase):
    def test_known_endpoints(self):
        self.assertEqual(label_font_size(14), 9)
        self.assertEqual(label_font_size(18), 12)

    def test_monotonic_increase(self):
        sizes = [label_font_size(z) for z in range(14, 19)]
        self.assertEqual(sizes, sorted(sizes))

    def test_default_scale_is_identity(self):
        for z in range(14, 19):
            self.assertEqual(label_font_size(z), label_font_size(z, 1.0))

    def test_scale_multiplies_size(self):
        # 9px @ z14 → 18px at 2×; 4px at 0.5× (round(4.5)→4, banker's rounding).
        self.assertEqual(label_font_size(14, 2.0), 18)
        self.assertEqual(label_font_size(14, 0.5), 4)
        self.assertEqual(label_font_size(18, 2.0), 24)

    def test_never_below_one_px(self):
        self.assertGreaterEqual(label_font_size(14, 0.01), 1)


@unittest.skipUnless(_IMPORT_OK, f"import failed: {globals().get('_IMPORT_ERR', '?')}")
class TestTileLabelBox(unittest.TestCase):
    def setUp(self):
        self.img = Image.new("RGBA", (TILE_SIZE, TILE_SIZE))
        self.draw = ImageDraw.Draw(self.img)
        self.font = ImageFont.load_default()

    def test_anchor_outside_tile_returns_none(self):
        # Anchor world-pixel belongs to tile (5,5); ask tile (0,0).
        wx, wy = 5 * TILE_SIZE + 10, 5 * TILE_SIZE + 10
        self.assertIsNone(tile_label_box(self.draw, (wx, wy), 0, 0, "Creek", self.font))

    def test_owned_anchor_returns_box_inside_tile(self):
        wx, wy = 3 * TILE_SIZE + 128, 3 * TILE_SIZE + 128
        box = tile_label_box(self.draw, (wx, wy), 3, 3, "Creek", self.font)
        self.assertIsNotNone(box)
        tx, ty, w, h = box
        # The text box is clamped fully inside the tile (with 2px margin).
        self.assertGreaterEqual(tx, 2.0)
        self.assertGreaterEqual(ty, 2.0)
        self.assertLessEqual(tx + w, TILE_SIZE - 2.0 + 1e-6)
        self.assertLessEqual(ty + h, TILE_SIZE - 2.0 + 1e-6)

    def test_half_open_ownership_exactly_one_tile(self):
        # An anchor exactly on a tile's top-left corner is owned by that tile,
        # not the one above/left (half-open bounds).
        wx, wy = float(4 * TILE_SIZE), float(4 * TILE_SIZE)
        self.assertIsNotNone(tile_label_box(self.draw, (wx, wy), 4, 4, "X", self.font))
        self.assertIsNone(tile_label_box(self.draw, (wx, wy), 3, 3, "X", self.font))


@unittest.skipUnless(_IMPORT_OK, f"import failed: {globals().get('_IMPORT_ERR', '?')}")
class TestDeclutterLabels(unittest.TestCase):
    def test_overlapping_lower_priority_dropped(self):
        # Two boxes whose grown rects overlap; the first (higher priority) wins.
        items = [
            ((10.0, 10.0, 20.0, 10.0), "keep"),
            ((12.0, 12.0, 20.0, 10.0), "drop"),
        ]
        self.assertEqual(declutter_labels(items), ["keep"])

    def test_well_separated_labels_all_kept(self):
        far = 3 * LABEL_MIN_GAP_PX + 100
        items = [
            ((0.0, 0.0, 10.0, 10.0), "a"),
            ((far, far, 10.0, 10.0), "b"),
        ]
        self.assertEqual(declutter_labels(items), ["a", "b"])

    def test_input_order_preserved(self):
        items = [
            ((0.0, 0.0, 5.0, 5.0), "a"),
            ((1000.0, 0.0, 5.0, 5.0), "b"),
            ((2000.0, 0.0, 5.0, 5.0), "c"),
        ]
        self.assertEqual(declutter_labels(items), ["a", "b", "c"])


if __name__ == "__main__":
    unittest.main()
