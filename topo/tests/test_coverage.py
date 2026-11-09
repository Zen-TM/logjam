"""The Coverage overlay's build: which of the release's maps count for each
carrier, the class of a cell, the monthly publish, and the build's agreement
with the clients (`NSW_COVERAGE` in shared/src/nswCoverage.ts)."""

import io
import json
import os
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import _native_stub  # noqa: F401,E402  (stubs osgeo when absent on the host)

import build_coverage as bc  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
SHARED = (ROOT / "shared/src/nswCoverage.ts").read_text()
DEM = (ROOT / "shared/src/demSources.ts").read_text()


def _resource(name, rid=None, modified="2026-09-21T05:41:27"):
    rid = rid or name
    return {
        "name": name,
        "id": rid,
        "url": f"https://example.test/{rid}.kml",
        "last_modified": modified,
    }


def _release(year=2026, extra=()):
    """A release with an Outdoor and an Ext Ant 4G map for every network."""
    names = [
        f"Coverage map - {n} - 4G - {lvl} - {year}"
        for n in ("Telstra", "Optus", "TPG", "Optus-TPG MOCN")
        for lvl in ("Outdoor", "Ext Ant")
    ]
    return [_resource(n) for n in [*names, *extra]]


class TestLatestMaps(unittest.TestCase):
    # Mutation: let the pattern run past the level, and Telstra's resellers'
    # smaller Wholesale map joins Telstra's own.
    def test_leaves_out_wholesale_3g_and_band_maps(self):
        release = bc.latest_maps(
            _release(
                extra=(
                    "Coverage map - Telstra - 4G - Outdoor - Wholesale - 2026",
                    "Coverage map - Optus - 3G - Outdoor - 2026",
                    "Coverage maps by frequency band - Optus - 2026",
                )
            )
        )
        names = {(m["network"], m["technology"], m["level"]) for m in release["maps"]}
        self.assertEqual(len(names), 8)
        self.assertTrue(all(t == "4G" for _, t, _ in names))

    # Mutation: match "5G" before "5G NSA", and NSA maps never count.
    def test_reads_5g_nsa_and_an_en_dash(self):
        release = bc.latest_maps(
            _release(extra=("Coverage map - TPG - 5G NSA - Ext Ant – 2026",))
        )
        self.assertIn(
            ("TPG", "5G NSA", "Ext Ant"),
            {(m["network"], m["technology"], m["level"]) for m in release["maps"]},
        )

    # Mutation: take every year's maps, and 2025's coverage is unioned into 2026's.
    def test_takes_the_latest_year_alone(self):
        release = bc.latest_maps([*_release(2025), *_release(2026)])
        self.assertEqual(release["year"], 2026)
        self.assertEqual(len(release["maps"]), 8)

    # Mutation: drop the per-carrier check, and a release caught mid-upload
    # publishes "no coverage" across a carrier's whole network.
    def test_a_carrier_without_both_levels_stops_the_build(self):
        partial = [
            r
            for r in _release()
            if r["name"] != "Coverage map - TPG - 4G - Ext Ant - 2026"
        ]
        # TPG still has the MOCN's Ext Ant map, so drop that too.
        partial = [
            r
            for r in partial
            if r["name"] != "Coverage map - Optus-TPG MOCN - 4G - Ext Ant - 2026"
        ]
        with self.assertRaises(SystemExit):
            bc.latest_maps(partial)


class TestMapsFor(unittest.TestCase):
    maps = bc.latest_maps(_release())["maps"]

    def _networks(self, carrier, level):
        return {
            (m["network"], m["level"]) for m in bc.maps_for(carrier, level, self.maps)
        }

    # Mutation: drop the MOCN from TPG's networks, and TPG's regional coverage,
    # which its own maps leave out (the guide's footnote 11), reads as none.
    def test_the_mocn_counts_for_optus_and_tpg_alone(self):
        for carrier in ("optus", "tpg"):
            self.assertIn(
                ("Optus-TPG MOCN", "Outdoor"), self._networks(carrier, "Outdoor")
            )
        self.assertNotIn(
            "Optus-TPG MOCN", {n for n, _ in self._networks("telstra", "Ext Ant")}
        )

    # Mutation: mix the levels, and an antenna-only area reads as working in
    # the hand.
    def test_each_level_takes_its_own_maps(self):
        self.assertEqual(self._networks("telstra", "Outdoor"), {("Telstra", "Outdoor")})
        self.assertEqual(self._networks("telstra", "Ext Ant"), {("Telstra", "Ext Ant")})


@unittest.skipIf(_native_stub.is_stubbed("numpy"), "needs numpy")
class TestClassify(unittest.TestCase):
    # Mutation: any other order of the in-place steps, or drop `external |=
    # outdoor`, and a cell gets the wrong class: where Telstra's 5G works in
    # the hand but no Ext Ant map reaches, it would read as no coverage.
    def test_every_combination(self):
        import numpy as np

        land = np.array([1, 1, 1, 1, 0], np.uint8)
        outdoor = np.array([1, 1, 0, 0, 1], np.uint8)
        external = np.array([1, 0, 1, 0, 1], np.uint8)
        levels = bc.classify(land, outdoor, external)
        # In the hand, in the hand (with no Ext Ant map), antenna only,
        # neither, and the sea.
        self.assertEqual(levels.tolist(), [1, 1, 2, 3, 0])


class FakeS3:
    def __init__(self, state=None):
        self.objects = {}
        self.calls = []
        if state is not None:
            self.objects[bc.STATE_KEY] = json.dumps(state).encode()

    def list_objects_v2(self, Bucket, Prefix, MaxKeys):
        return {"KeyCount": sum(1 for k in self.objects if k.startswith(Prefix))}

    def get_object(self, Bucket, Key):
        return {"Body": io.BytesIO(self.objects[Key])}

    def upload_file(self, path, bucket, key, ExtraArgs=None):
        self.calls.append(key)
        self.objects[key] = Path(path).read_bytes()

    def put_object(self, Bucket, Key, Body, ContentType):
        self.calls.append(Key)
        self.objects[Key] = Body


class TestPublish(unittest.TestCase):
    def _publish(self, s3, resources):
        built = []

        def run(src, maps, coastline, out):
            built.append(maps)
            out.write_bytes(b"pmtiles")
            return {"telstra": {"outdoor": 0.5}}

        bc.publish(
            "bucket",
            s3=s3,
            get=lambda url: {"result": {"resources": resources}},
            fetch=lambda url, dest: dest.write_bytes(b""),
            run=run,
        )
        return built

    # Mutation: put the state before the archive, and an upload that fails
    # half way leaves a state that says the old archive is the new one.
    def test_a_new_release_uploads_the_archive_then_the_state(self):
        s3 = FakeS3()
        self.assertEqual(len(self._publish(s3, _release())), 1)
        self.assertEqual(s3.calls, [bc.ARCHIVE_KEY, bc.STATE_KEY])
        state = json.loads(s3.objects[bc.STATE_KEY])
        self.assertEqual(state["year"], 2026)

    # Mutation: compare nothing, and every month rebuilds 4 GB of maps.
    def test_an_unchanged_release_builds_nothing(self):
        s3 = FakeS3()
        self._publish(s3, _release())
        s3.calls.clear()
        self.assertEqual(self._publish(s3, _release()), [])
        self.assertEqual(s3.calls, [])

    # Mutation: compare the year alone, and a map the ACCC reissues within a
    # year is never picked up.
    def test_a_reissued_map_rebuilds(self):
        s3 = FakeS3()
        self._publish(s3, _release())
        reissued = _release()
        reissued[0]["last_modified"] = "2026-12-01T00:00:00"
        self.assertEqual(len(self._publish(s3, reissued)), 1)


KML = b"""<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Folder>
<Placemark><ExtendedData><SimpleData name="clipped_ge">POLYGON((9 9))</SimpleData>
</ExtendedData><MultiGeometry><Polygon><outerBoundaryIs><LinearRing><coordinates>
150,-33 151,-33 151,-34 150,-33</coordinates></LinearRing></outerBoundaryIs>
<innerBoundaryIs><LinearRing><coordinates>150.2,-33.2,0 150.3,-33.2,0 150.3,-33.3,0
150.2,-33.2,0</coordinates></LinearRing></innerBoundaryIs></Polygon><Polygon>
<outerBoundaryIs><LinearRing><coordinates>1,1 2,1 2,2 1,1</coordinates></LinearRing>
</outerBoundaryIs></Polygon></MultiGeometry></Placemark>
<Placemark><Point><coordinates>150,-33</coordinates></Point></Placemark>
</Folder></Document></kml>"""


class TestKml(unittest.TestCase):
    # Mutation: join every ring of a placemark into one polygon, or read the
    # attribute's WKT text, and the holes fill in or a feature is invented.
    def test_reads_each_polygon_with_its_holes(self):
        self.assertEqual(
            list(bc.kml_polygons(io.BytesIO(KML))),
            [
                [
                    "POLYGON((150 -33,151 -33,151 -34,150 -33))",
                    "POLYGON((150.2 -33.2,150.3 -33.2,150.3 -33.3,150.2 -33.2))",
                ],
                ["POLYGON((1 1,2 1,2 2,1 1))"],
            ],
        )

    # Mutation: drop the `remove`, and the folder keeps every placemark read:
    # a 1.4 GB map no longer fits the task's memory.
    def test_a_placemark_is_freed_once_read(self):
        folders = []
        real = bc.ET.iterparse

        def spy(stream, events):
            for event, element in real(stream, events):
                if element.tag.endswith("Folder") and event == "start":
                    folders.append(element)
                yield event, element

        bc.ET.iterparse = spy
        try:
            list(bc.kml_polygons(io.BytesIO(KML)))
        finally:
            bc.ET.iterparse = real
        self.assertEqual(len(folders[0]), 0)


@unittest.skipIf(
    _native_stub.is_stubbed("osgeo") or _native_stub.is_stubbed("shapely"),
    "needs GDAL and shapely",
)
class TestBurn(unittest.TestCase):
    # Mutation: burn the holes as 1, OR the scratch window in one cell off, or
    # fill the outer ring alone, and a hole in the coverage reads as covered.
    def test_a_polygon_with_holes_burns_as_gdal_fills_it_whole(self):
        import tempfile

        import numpy as np
        from osgeo import gdal, ogr

        box, grid_deg = (150.0, -34.0, 151.0, -33.0), 0.01
        outer = "150.103 -33.107,150.893 -33.111,150.871 -33.889,150.117 -33.861,150.103 -33.107"
        holes = [
            "150.2 -33.2,150.43 -33.21,150.41 -33.47,150.2 -33.2",
            "150.6 -33.6,150.8 -33.6,150.8 -33.8,150.6 -33.8,150.6 -33.6",
        ]
        coords = lambda ring: " ".join(p.replace(" ", ",") for p in ring.split(","))  # noqa: E731
        kml = (
            '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><Polygon>'
            f"<outerBoundaryIs><LinearRing><coordinates>{coords(outer)}</coordinates>"
            "</LinearRing></outerBoundaryIs>"
            + "".join(
                f"<innerBoundaryIs><LinearRing><coordinates>{coords(h)}</coordinates>"
                "</LinearRing></innerBoundaryIs>"
                for h in holes
            )
            + "</Polygon></Placemark></Document></kml>"
        )
        saved = bc.BOX, bc.GRID_DEG
        bc.BOX, bc.GRID_DEG = box, grid_deg
        try:
            with tempfile.NamedTemporaryFile(suffix=".kml") as f:
                f.write(kml.encode())
                f.flush()
                ours = np.zeros(bc.grid_shape(), np.uint8)
                self.assertEqual(bc.burn_kml(ours, Path(f.name)), 1)
            whole = np.zeros(bc.grid_shape(), np.uint8)
            ds, srs = bc._grid_dataset(whole)
            mem = ogr.GetDriverByName("MEM").CreateDataSource("")
            layer = mem.CreateLayer("whole", srs, ogr.wkbPolygon)
            feature = ogr.Feature(layer.GetLayerDefn())
            wkt = "POLYGON(" + ",".join(f"({r})" for r in [outer, *holes]) + ")"
            feature.SetGeometry(ogr.CreateGeometryFromWkt(wkt))
            layer.CreateFeature(feature)
            gdal.RasterizeLayer(ds, [1], layer, burn_values=[1])
            ds.FlushCache()
        finally:
            bc.BOX, bc.GRID_DEG = saved
        self.assertGreater(int(whole.sum()), 1000)
        self.assertTrue(np.array_equal(ours, whole))

    # Mutation: read the traced layer through a dataset nothing holds, and
    # GDAL frees it mid-read: the first full build died there.
    def test_traces_each_run_of_a_level_with_its_carrier(self):
        import numpy as np

        saved = bc.BOX, bc.GRID_DEG
        bc.BOX, bc.GRID_DEG = (150.0, -34.0, 151.0, -33.0), 0.25
        try:
            levels = np.array(
                [[1, 1, 2, 0], [1, 1, 2, 0], [3, 3, 2, 0], [3, 3, 3, 0]], np.uint8
            )
            out = io.StringIO()
            self.assertEqual(bc.polygonize(levels, "tpg", out), 3)
        finally:
            bc.BOX, bc.GRID_DEG = saved
        features = [json.loads(line) for line in out.getvalue().splitlines()]
        self.assertEqual(
            sorted(f["properties"]["level"] for f in features),
            ["external", "none", "outdoor"],
        )
        self.assertTrue(all(f["properties"]["carrier"] == "tpg" for f in features))

    # Mutation: trace the grid whole, and a run that spans the state is one
    # polygon of hundreds of thousands of points, which tippecanoe clips into
    # every tile for hours.
    def test_cuts_runs_on_block_lines_and_keeps_their_area(self):
        import numpy as np
        from shapely.geometry import shape

        saved = bc.BOX, bc.GRID_DEG, bc.BLOCK
        bc.BOX, bc.GRID_DEG, bc.BLOCK = (150.0, -34.0, 151.0, -33.0), 0.25, 2
        try:
            levels = np.full((4, 4), 3, np.uint8)
            levels[0, 0] = 1
            out = io.StringIO()
            bc.polygonize(levels, "tpg", out)
        finally:
            bc.BOX, bc.GRID_DEG, bc.BLOCK = saved
        features = [json.loads(line) for line in out.getvalue().splitlines()]
        none = [
            shape(f["geometry"]) for f in features if f["properties"]["level"] == "none"
        ]
        self.assertEqual(len(none), 4)  # one per block
        self.assertAlmostEqual(sum(p.area for p in none), 15 * 0.25**2)


@unittest.skipIf(_native_stub.is_stubbed("shapely"), "needs shapely")
class TestPieces(unittest.TestCase):
    # Mutation: yield the polygon whole, or cut between grid lines, and a
    # regional polygon takes half an hour to fill, or a row of cells on a cut
    # can fall between its halves.
    def test_halves_a_big_polygon_on_grid_lines_without_losing_area(self):
        from shapely.geometry import Point

        ring = Point(150.00013, -33.00017).buffer(1.0, quad_segs=2_000)  # 8,000 points
        parts = list(bc.pieces(ring))
        self.assertGreater(len(parts), 1)
        for part in parts:
            self.assertLessEqual(len(part.exterior.coords), bc.SPLIT_POINTS + 8)
        self.assertAlmostEqual(sum(p.area for p in parts), ring.area, places=9)
        for part in parts:
            for x, y in part.exterior.coords:
                # A point is the circle's own, or a corner where two cuts
                # cross, both on grid lines.
                on_ring = (
                    abs(Point(x, y).distance(Point(150.00013, -33.00017)) - 1.0) < 1e-6
                )
                cells = ((x - bc.BOX[0]) / bc.GRID_DEG, (y - bc.BOX[3]) / bc.GRID_DEG)
                on_grid = all(abs(c - round(c)) < 1e-6 for c in cells)
                self.assertTrue(on_ring or on_grid, (x, y))

    # Mutation: clip nothing to the box, and a national map's polygons are
    # filled across states the grid doesn't hold.
    def test_clips_to_the_box(self):
        from shapely.geometry import box

        (part,) = bc.pieces(box(130, -40, 150, -30))
        self.assertEqual(part.bounds, (bc.BOX[0], bc.BOX[1], 150.0, -30.0))


class TestClients(unittest.TestCase):
    # Mutation: change a value here alone, and the clients draw nothing, or ask
    # for tiles the archive doesn't hold.
    def test_the_clients_read_what_the_build_writes(self):
        self.assertIn(f'sourceLayer: "{bc.SOURCE_LAYER}"', SHARED)
        self.assertIn(f'archivePath: "{bc.ARCHIVE_KEY}"', SHARED)
        self.assertIn(f"minzoom: {bc.ZMIN},", SHARED)
        self.assertIn(f"maxzoom: {bc.ZMAX},", SHARED)
        self.assertIn(f'"{bc.CREDIT}"', SHARED)

    # Mutation: rename a carrier or a level on one side, and the map draws no
    # hatch for it, or a tap names nothing.
    def test_carriers_and_levels_match(self):
        self.assertEqual(
            re.findall(r'\{ id: "(\w+)", name:', SHARED), list(bc.NETWORKS)
        )
        (levels,) = re.findall(r"COVERAGE_LEVELS = \[([^\]]*)\]", SHARED)
        self.assertEqual(re.findall(r'"(\w+)"', levels), list(bc.LEVELS.values()))

    # Mutation: move the box here alone, and the hatch stops short of, or runs
    # past, the area every other statewide layer covers.
    def test_the_box_is_the_statewide_layers(self):
        west, south, east, north = bc.BOX
        self.assertIn(f"coverage: [{west}, {south}, {east}, {north}]", DEM)

    # Mutation: put --detect-shared-borders back, and the statewide archive
    # tiles for hours on four cores.
    def test_tiles_without_the_slow_border_passes(self):
        tip = bc.tippecanoe_command(Path("a"), Path("b"), Path("t"))
        self.assertNotIn("--detect-shared-borders", tip)
        self.assertNotIn("--coalesce", tip)


if __name__ == "__main__":
    unittest.main()
