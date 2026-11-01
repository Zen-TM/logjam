"""The Land overlay's build: its class check, and its agreement with the clients."""

import os
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from build_land_tenure import (  # noqa: E402
    ATTRIBUTE,
    CREDIT,
    SOURCE_LAYER,
    TENURE_CLASSES,
    ZMAX,
    ZMIN,
    BUFFER,
    classes_in,
    flatgeobuf_command,
    tippecanoe_command,
    unknown_classes,
)

ROOT = Path(__file__).resolve().parents[2]
SHARED = (ROOT / "shared/src/nswLand.ts").read_text()


class TestClasses(unittest.TestCase):
    # Mutation: change a class here or in LAND_CLASSES alone, and either the
    # build refuses good data or that land is drawn with no tint.
    def test_the_build_knows_the_classes_the_clients_draw(self):
        drawn = re.findall(r'source: "([^"]+)"', SHARED)
        self.assertEqual(list(TENURE_CLASSES), drawn)

    # Mutation: return nothing from `unknown_classes`, and a class the next
    # release adds ships undrawn.
    def test_a_class_no_client_knows_stops_the_build(self):
        self.assertEqual(unknown_classes(["Private", "Marine Park"]), ["Marine Park"])
        self.assertEqual(unknown_classes(TENURE_CLASSES), [])

    # Mutation: a pattern that stops at a space reads "National Park" as
    # "National", and the build refuses every release.
    def test_reads_the_classes_ogrinfo_prints(self):
        output = (
            "OGRFeature(SELECT):0\n  TenureClass (String) = National Park\n"
            "OGRFeature(SELECT):1\n  TenureClass (String) = Private\n"
        )
        self.assertEqual(classes_in(output), {"National Park", "Private"})


class TestArchive(unittest.TestCase):
    # Mutation: change a value here alone, and the clients draw nothing, or
    # ask for tiles the archive doesn't hold.
    def test_the_clients_read_what_the_build_writes(self):
        self.assertIn(f'sourceLayer: "{SOURCE_LAYER}"', SHARED)
        self.assertIn(f'classProperty: "{ATTRIBUTE}"', SHARED)
        self.assertIn(f"minzoom: {ZMIN},", SHARED)
        # A map draws a 256-unit tile 512 pixels across.
        self.assertIn(f"LAND_TILE_MARGIN_PX = {BUFFER * 2};", SHARED)
        self.assertIn(f"maxzoom: {ZMAX},", SHARED)
        self.assertIn(f'"Land: {CREDIT}"', SHARED)

    # Mutation: drop `-select`, and the archive carries the source's other
    # columns at every zoom.
    def test_keeps_only_the_class(self):
        ogr = flatgeobuf_command(Path("a.gdb"), "l", Path("a.fgb"))
        self.assertEqual(ogr[ogr.index("-select") + 1], ATTRIBUTE)
        tip = tippecanoe_command(Path("a.fgb"), Path("a.pmtiles"), Path("t"))
        self.assertEqual(tip[tip.index("-y") + 1], ATTRIBUTE)

    # Mutation: drop `--coalesce`, and the tiles carry a polygon per lot, which
    # is the cadastre the proposal leaves out.
    def test_merges_lots_of_a_class(self):
        tip = tippecanoe_command(Path("a.fgb"), Path("a.pmtiles"), Path("t"))
        self.assertIn("--coalesce", tip)


if __name__ == "__main__":
    unittest.main()
