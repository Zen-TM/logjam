"""OSM tag → feature category classification (pure dict logic)."""
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import _native_stub  # noqa: F401,E402

try:
    import pipeline  # noqa: E402
    from pipeline import classify_osm_element, fetch_osm_features  # noqa: E402
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


class _FakeResponse:
    """A mirror that answers 200 with a body that isn't the JSON we asked for."""

    def __init__(self, payload):
        self.status_code = 200
        self.ok = True
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


@unittest.skipUnless(_IMPORT_OK, f"import failed: {globals().get('_IMPORT_ERR', '?')}")
class TestOverpassDegradesOnBadBody(unittest.TestCase):
    """STP-003: fetch_osm_features degrades to an empty features layer.

    A mirror returning 200 with an HTML interstitial used to raise
    JSONDecodeError from a resp.json() sitting OUTSIDE the retry loop, and the
    sole caller has no handler — so one flaky mirror failed the entire topo
    job instead of dropping the features layer as designed.
    """

    def _run(self, payload):
        calls = []

        def _post(url, **kwargs):
            calls.append(url)
            return _FakeResponse(payload)

        with mock.patch.object(pipeline.requests, "post", _post), \
                mock.patch("time.sleep", lambda _s: None):
            result = fetch_osm_features(150.0, -34.0, 150.1, -33.9, work_dir="/nonexistent")
        return result, calls

    def test_html_body_returns_none_after_rotating_every_mirror(self):
        result, calls = self._run(ValueError("Expecting value: line 1 column 1 (char 0)"))
        self.assertIsNone(result)
        self.assertEqual(len(calls), 6, "3 mirrors x 2 attempts")
        self.assertEqual(len(set(calls)), 3, "all mirrors tried")

    def test_json_but_not_an_object_returns_none(self):
        # A bare list would have blown up later on raw.get("elements").
        result, _ = self._run([1, 2, 3])
        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
