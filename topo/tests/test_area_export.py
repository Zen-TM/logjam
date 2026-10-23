"""Unit tests for the pure pieces of area_export.py: the MGA zone, which steps
a set of layers needs, the credit line, the tiles over a box, and the layer
names shared/src/areaExport.ts declares, and the archive reader against one
pmtiles itself wrote. The GDAL steps need the worker image, so they are not
run here (topo/AGENTS.md).
"""

import os
import re
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import _native_stub  # noqa: F401,E402

from _native_stub import is_stubbed  # noqa: E402

from area_export import (  # noqa: E402
    LAYERS,
    credit_line,
    mga_epsg,
    plan,
    tile_range,
)

_AREA_EXPORT_TS = os.path.join(
    os.path.dirname(__file__), "..", "..", "shared", "src", "areaExport.ts"
)
ATTRIBUTION = (
    "Derived from the NSW 5 m Digital Elevation Model, © State of New South "
    "Wales (Spatial Services), extracted October 2026. CC BY 3.0 AU."
)


class MgaZone(unittest.TestCase):
    # Mutation: an off-by-one in the zone, and a Katoomba export lands in
    # zone 55, a few hundred kilometres east of its own grid.
    def test_zone_of_the_box_centre(self):
        self.assertEqual(mga_epsg(150.3), 7856)  # Katoomba
        self.assertEqual(mga_epsg(147.0), 7855)
        self.assertEqual(mga_epsg(141.5), 7854)


class Plan(unittest.TestCase):
    # Mutation: read the heights only when they are asked for, and hillshade
    # or contours alone have nothing to be made from.
    def test_hillshade_and_contours_need_the_heights(self):
        self.assertTrue(plan(["hillshade"])["heights"])
        self.assertTrue(plan(["contours"])["heights"])
        self.assertFalse(plan(["slope"])["heights"])
        self.assertEqual(
            plan(["slope"]),
            {"heights": False, "slope": True, "hillshade": False, "contours": False},
        )


class Credit(unittest.TestCase):
    # Mutation: list the layers in the order asked, not the file's order.
    def test_one_line_for_every_layer_in_file_order(self):
        self.assertEqual(
            credit_line(["contours", "heights", "slope"], ATTRIBUTION),
            "Heights, slope and contours: derived from the NSW 5 m Digital "
            "Elevation Model, © State of New South Wales (Spatial Services), "
            "extracted October 2026. CC BY 3.0 AU.",
        )
        self.assertTrue(
            credit_line(["slope"], ATTRIBUTION).startswith("Slope: derived")
        )


@unittest.skipIf(is_stubbed("numpy"), "needs numpy")
class Tiles(unittest.TestCase):
    def test_the_tiles_cover_the_box(self):
        # Katoomba, about 2 km square, at z15 (~1 km tiles here).
        x0, y0, x1, y1 = tile_range((150.30, -33.73, 150.32, -33.71), 15)
        self.assertEqual((x1 - x0 + 1, y1 - y0 + 1), (3, 3))
        self.assertEqual(x0, int((150.30 + 180) / 360 * 2**15))


@unittest.skipIf(is_stubbed("pmtiles"), "needs pmtiles")
class ArchiveReads(unittest.TestCase):
    # Mutation: stop at the root directory, or read a tile without the tile
    # data offset, and tiles behind a leaf directory come back wrong.
    def test_tiles_match_pmtiles_own_reader(self):
        import io
        import random

        from pmtiles.reader import MemorySource, Reader
        from pmtiles.tile import Compression, TileType, zxy_to_tileid
        from pmtiles.writer import Writer

        from area_export import Archive

        rng = random.Random(7)
        # Scattered ids and sizes, enough that the root overflows into leaves.
        tiles = {
            (x, y): rng.randbytes(rng.randint(1, 40))
            for x, y in {
                (rng.randrange(4096), rng.randrange(4096)) for _ in range(20000)
            }
        }
        buf = io.BytesIO()
        writer = Writer(buf)
        for x, y in sorted(tiles, key=lambda xy: zxy_to_tileid(12, *xy)):
            writer.write_tile(zxy_to_tileid(12, x, y), tiles[(x, y)])
        writer.finalize(
            {
                "tile_type": TileType.PNG,
                "tile_compression": Compression.NONE,
                "min_zoom": 12,
                "max_zoom": 12,
                "min_lon_e7": 0,
                "min_lat_e7": 0,
                "max_lon_e7": 0,
                "max_lat_e7": 0,
                "center_zoom": 12,
                "center_lon_e7": 0,
                "center_lat_e7": 0,
            },
            {"attribution": "made up"},
        )
        source = MemorySource(buf.getvalue())
        self.assertGreater(Reader(source).header()["leaf_directory_length"], 0)

        archive = Archive(source)
        self.assertEqual(archive.metadata()["attribution"], "made up")
        for (x, y), data in list(tiles.items())[:500]:
            self.assertEqual(archive.get(12, x, y), data)
        absent = next(
            (x, y) for x in range(4096) for y in range(4096) if (x, y) not in tiles
        )
        self.assertIsNone(archive.get(12, *absent))


class SyncWithShared(unittest.TestCase):
    # Mutation: add a layer to AREA_EXPORT_LAYERS only, and the API queues a
    # layer this worker refuses.
    def test_layer_names_match_area_export_ts(self):
        with open(_AREA_EXPORT_TS, encoding="utf-8") as fh:
            src = fh.read()
        match = re.search(r"AREA_EXPORT_LAYERS = \[(?P<body>[^\]]*)\]", src, re.DOTALL)
        self.assertIsNotNone(match, "AREA_EXPORT_LAYERS not found in areaExport.ts")
        self.assertEqual(tuple(re.findall(r'"([a-z]+)"', match.group("body"))), LAYERS)


if __name__ == "__main__":
    unittest.main()
