"""The Fire history overlay's archive: one fire per area, and its agreement
with the clients (`NSW_FIRE` in shared/src/nswFire.ts)."""

import os
import re
import sys
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import _native_stub  # noqa: F401,E402  (stubs osgeo when absent on the host)

import build_fire_history as fh  # noqa: E402

SHARED = (Path(__file__).resolve().parents[2] / "shared/src/nswFire.ts").read_text()
REAL_SHAPELY = not _native_stub.is_stubbed("shapely")
if REAL_SHAPELY:
    from shapely.geometry import LineString, box
    from shapely.geometry.collection import GeometryCollection


def _fire(oid, when, kind, geom):
    return {
        "OBJECTID": oid,
        "StartDate": None,
        "EndDate": when,
        "FireType": kind,
        "geometry": geom,
    }


@unittest.skipUnless(REAL_SHAPELY, "needs shapely (requirements-test.txt)")
class TestFlatten(unittest.TestCase):
    def _areas(self, features):
        return list(fh.flatten(fh.dated_fires(features, 2026)))

    # Mutation: drop the difference in flatten(), and where two fires overlap
    # the tint draws twice and the older fire answers a tap there.
    def test_an_area_keeps_only_its_most_recent_fire(self):
        areas = self._areas(
            [
                _fire(1, date(2013, 10, 17), 1, box(0, 0, 2, 2)),
                _fire(2, date(2019, 12, 5), 1, box(1, 0, 3, 2)),
                _fire(3, date(2023, 5, 1), 2, box(0, 1, 3, 3)),
            ]
        )
        self.assertEqual(
            [(when, kind) for when, kind, _ in areas],
            [(date(2023, 5, 1), 2), (date(2019, 12, 5), 1), (date(2013, 10, 17), 1)],
        )
        shapes = [geom for _, _, geom in areas]
        self.assertEqual([g.area for g in shapes], [6, 2, 1])
        self.assertTrue(shapes[2].equals(box(0, 0, 1, 1)))
        for i, a in enumerate(shapes):
            for b in shapes[i + 1 :]:
                self.assertEqual(a.intersection(b).area, 0)

    # Mutation: sort on the date alone, and two fires of one day overlap in an
    # order that changes from build to build.
    def test_a_tie_on_the_date_goes_to_the_later_objectid(self):
        areas = self._areas(
            [
                _fire(8, date(2020, 1, 1), 1, box(0, 0, 2, 2)),
                _fire(9, date(2020, 1, 1), 2, box(0, 0, 2, 2)),
            ]
        )
        self.assertEqual([kind for _, kind, _ in areas], [2])

    # Mutation: keep a fire wholly under a newer one, and the archive carries
    # an empty feature for each.
    def test_a_fire_wholly_burnt_over_again_is_left_out(self):
        areas = self._areas(
            [
                _fire(1, date(2001, 1, 1), 1, box(1, 1, 2, 2)),
                _fire(2, date(2002, 1, 1), 1, box(0, 0, 3, 3)),
            ]
        )
        self.assertEqual(len(areas), 1)

    # Mutation: drop resolve_fire_date, and the 1899 null sentinel and
    # undated polygons draw as the oldest fires.
    def test_undated_polygons_are_dropped(self):
        areas = self._areas(
            [
                _fire(1, None, 1, box(0, 0, 1, 1)),
                _fire(2, date(1899, 12, 30), 1, box(0, 0, 1, 1)),
                _fire(3, date(2019, 12, 5), 1, None),
            ]
        )
        self.assertEqual(areas, [])

    # Mutation: return the geometry as it is, and a difference that leaves a
    # line beside a polygon writes a collection tippecanoe draws as a line.
    def test_only_polygons_reach_the_archive(self):
        mixed = GeometryCollection([box(0, 0, 1, 1), LineString([(2, 2), (3, 3)])])
        self.assertEqual(fh.polygonal(mixed).geom_type, "MultiPolygon")
        self.assertEqual(fh.polygonal(mixed).area, 1)
        self.assertIsNone(fh.polygonal(LineString([(0, 0), (1, 1)])))

    # Mutation: rename a property here alone, and the clients draw no tint.
    def test_writes_the_properties_the_clients_read(self):
        line = fh.overlay_feature(date(2019, 12, 5), 1, box(0, 0, 1, 1))
        self.assertIn('"properties":{"year": 2019, "month": 12, "type": 1}', line)
        line = fh.overlay_feature(date(2019, 12, 5), None, box(0, 0, 1, 1))
        self.assertNotIn('"type": ', line)


class TestArchive(unittest.TestCase):
    # Mutation: change a value here or in NSW_FIRE alone, and the clients ask
    # for a file, a layer or zooms the archive doesn't have.
    def test_the_clients_read_what_the_build_writes(self):
        self.assertIn(f'archivePath: "{fh.ARCHIVE_KEY}"', SHARED)
        self.assertIn(f'sourceLayer: "{fh.OVERLAY_LAYER}"', SHARED)
        self.assertIn(f"minzoom: {fh.OVERLAY_ZMIN},", SHARED)
        self.assertIn(f"maxzoom: {fh.OVERLAY_ZMAX},", SHARED)
        self.assertEqual(
            re.findall(r'(\w+)Property: "(\w+)"', SHARED),
            [("year", "year"), ("month", "month"), ("type", "type")],
        )
        self.assertIn(f'"{fh.OVERLAY_CREDIT}"', SHARED)

    # Mutation: drop --no-tile-size-limit, and tippecanoe thins the statewide
    # tiles, leaving burnt ground with no answer to a tap.
    def test_tiles_keep_every_area(self):
        cmd = fh.tippecanoe_command(Path("a"), Path("b"), Path("t"))
        self.assertIn("--no-tile-size-limit", cmd)
        self.assertIn("--no-feature-limit", cmd)
        self.assertEqual(cmd[cmd.index("-l") + 1], fh.OVERLAY_LAYER)


if __name__ == "__main__":
    unittest.main()
