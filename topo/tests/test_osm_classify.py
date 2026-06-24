"""OSM tag → feature category classification (pure dict logic)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import _native_stub  # noqa: F401,E402

try:
    from pipeline import classify_osm_element  # noqa: E402
    _IMPORT_OK = True
except Exception as _exc:  # noqa: BLE001
    _IMPORT_OK = False
    _IMPORT_ERR = _exc


@unittest.skipUnless(_IMPORT_OK, f"import failed: {globals().get('_IMPORT_ERR', '?')}")
class TestClassifyOsmElement(unittest.TestCase):
    def test_each_category(self):
        cases = {
            "waterfall": {"waterway": "waterfall"},
            "ford": {"ford": "yes"},
            "bridge": {"bridge": "yes"},
            "viewpoint": {"tourism": "viewpoint"},
            "hut": {"amenity": "shelter"},
            "trailhead": {"highway": "trailhead"},
            "waterway": {"waterway": "creek"},
            "track": {"highway": "path"},
            "road": {"highway": "secondary"},
            "building": {"building": "yes"},
            "power": {"power": "line"},
            "campsite": {"tourism": "camp_site"},
            "peak": {"natural": "peak"},
            "spring": {"natural": "spring"},
            "gate": {"barrier": "gate"},
            "cave": {"natural": "cave_entrance"},
        }
        for expected, tags in cases.items():
            self.assertEqual(classify_osm_element(tags), expected, f"tags={tags}")

    def test_trailhead_via_guidepost(self):
        self.assertEqual(classify_osm_element({"information": "guidepost"}), "trailhead")

    def test_bridge_overrides_highway(self):
        # A highway-tagged bridge classifies as bridge, not track/road.
        self.assertEqual(classify_osm_element({"highway": "track", "bridge": "yes"}), "bridge")

    def test_ford_overrides_highway(self):
        self.assertEqual(classify_osm_element({"highway": "path", "ford": "yes"}), "ford")

    def test_waterfall_overrides_waterway(self):
        self.assertEqual(classify_osm_element({"waterway": "waterfall"}), "waterfall")

    def test_alpine_hut_stays_campsite_for_backwards_compat(self):
        self.assertEqual(classify_osm_element({"tourism": "alpine_hut"}), "campsite")
        self.assertEqual(classify_osm_element({"tourism": "wilderness_hut"}), "campsite")

    def test_unknown_tags_return_none(self):
        self.assertIsNone(classify_osm_element({}))
        self.assertIsNone(classify_osm_element({"shop": "bakery"}))
        self.assertIsNone(classify_osm_element({"highway": "motorway"}))  # not in road set


if __name__ == "__main__":
    unittest.main()
