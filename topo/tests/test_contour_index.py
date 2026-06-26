"""The contour STRtree index must return exactly the features the old
per-feature bbox reject did — same tiles, just without the O(tiles × features)
scan that made large-job renders quadratic.

Runs a real shapely STRtree, so it skips when shapely is the host stub and
runs for real inside the worker Docker image.
"""
import json
import os
import random
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import _native_stub  # noqa: F401,E402  (stubs shapely when absent on the host)

_REAL_SHAPELY = not _native_stub.is_stubbed("shapely")

if _REAL_SHAPELY:
    from shapely.geometry import box as shapely_box  # noqa: E402
    from pipeline import (  # noqa: E402
        _contour_index_cache,
        _geojson_cache,
        _load_contour_index,
    )


def _linestring(coords, elev=10):
    return {
        "type": "Feature",
        "properties": {"elev": elev},
        "geometry": {"type": "LineString", "coordinates": coords},
    }


@unittest.skipUnless(_REAL_SHAPELY, "needs real shapely (skipped under host stub)")
class TestContourIndexEquivalence(unittest.TestCase):
    def setUp(self):
        _contour_index_cache.clear()
        _geojson_cache.clear()
        rng = random.Random(7)
        feats = []
        for _ in range(400):
            x0 = rng.uniform(150.0, 150.5)
            y0 = rng.uniform(-34.0, -33.5)
            coords = [
                [x0 + rng.uniform(0, 0.02), y0 + rng.uniform(0, 0.02)]
                for _ in range(rng.randint(2, 6))
            ]
            feats.append(_linestring(coords))
        # Noise that the index must ignore: a non-LineString and an empty line.
        feats.append({"type": "Feature", "properties": {},
                      "geometry": {"type": "Point", "coordinates": [150.1, -33.8]}})
        feats.append({"type": "Feature", "properties": {},
                      "geometry": {"type": "LineString", "coordinates": []}})
        self.tmp = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp, "contours.geojson")
        with open(self.path, "w") as f:
            json.dump({"type": "FeatureCollection", "features": feats}, f)

    def _brute(self, qbox):
        """Old reject: keep LineStrings whose bbox intersects the query box."""
        qlon0, qlat0, qlon1, qlat1 = qbox
        with open(self.path) as f:
            gj = json.load(f)
        out = set()
        for feat in gj["features"]:
            geom = feat.get("geometry", {})
            if geom.get("type") != "LineString":
                continue
            coords = geom.get("coordinates", [])
            if not coords:
                continue
            lons = [c[0] for c in coords]
            lats = [c[1] for c in coords]
            if (max(lons) < qlon0 or min(lons) > qlon1
                    or max(lats) < qlat0 or min(lats) > qlat1):
                continue
            out.add(tuple(map(tuple, coords)))
        return out

    def _tree(self, qbox):
        records, tree = _load_contour_index(self.path)
        out = set()
        for idx in tree.query(shapely_box(*qbox)):
            _feat, coords = records[int(idx)]
            out.add(tuple(map(tuple, coords)))
        return out

    def test_query_matches_bruteforce(self):
        rng = random.Random(99)
        for _ in range(50):
            lon0 = rng.uniform(149.9, 150.6)
            lat0 = rng.uniform(-34.1, -33.4)
            qbox = (lon0, lat0,
                    lon0 + rng.uniform(0.001, 0.05),
                    lat0 + rng.uniform(0.001, 0.05))
            self.assertEqual(self._tree(qbox), self._brute(qbox),
                             f"index/brute mismatch for query {qbox}")

    def test_only_valid_linestrings_indexed(self):
        records, _tree = _load_contour_index(self.path)
        # 400 LineStrings; the Point and the empty-coords line are excluded.
        self.assertEqual(len(records), 400)

    def test_empty_contours_give_no_tree(self):
        _contour_index_cache.clear()
        _geojson_cache.clear()
        empty = os.path.join(self.tmp, "empty.geojson")
        with open(empty, "w") as f:
            json.dump({"type": "FeatureCollection", "features": []}, f)
        records, tree = _load_contour_index(empty)
        self.assertEqual(records, [])
        self.assertIsNone(tree)


if __name__ == "__main__":
    unittest.main()
