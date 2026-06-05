"""MBTiles SQLite schema, TMS Y-flip on insert, and bounds finalisation."""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import _native_stub  # noqa: F401,E402

try:
    from topo_mbtiles import (  # noqa: E402
        ZOOM_MAX,
        ZOOM_MIN,
        create_mbtiles,
        finalise_bounds,
        insert_tile,
    )
    _IMPORT_OK = True
except Exception as _exc:  # noqa: BLE001
    _IMPORT_OK = False
    _IMPORT_ERR = _exc


@unittest.skipUnless(_IMPORT_OK, f"import failed: {globals().get('_IMPORT_ERR', '?')}")
class TestMbtilesSchema(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".mbtiles", delete=False)
        self.tmp.close()
        self.path = self.tmp.name

    def tearDown(self):
        if os.path.exists(self.path):
            os.unlink(self.path)

    def test_schema_tables_and_unique_index(self):
        conn = create_mbtiles(self.path, "test", "desc")
        try:
            cur = conn.cursor()
            tables = {r[0] for r in cur.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )}
            self.assertIn("metadata", tables)
            self.assertIn("tiles", tables)
            idx = {r[0] for r in cur.execute(
                "SELECT name FROM sqlite_master WHERE type='index'"
            )}
            self.assertIn("tile_index", idx)
        finally:
            conn.close()

    def test_initial_metadata(self):
        conn = create_mbtiles(self.path, "myname", "mydesc")
        try:
            meta = dict(conn.execute("SELECT name, value FROM metadata"))
            self.assertEqual(meta["name"], "myname")
            self.assertEqual(meta["description"], "mydesc")
            self.assertEqual(meta["format"], "png")
            self.assertEqual(meta["minzoom"], str(ZOOM_MIN))
            self.assertEqual(meta["maxzoom"], str(ZOOM_MAX))
            # bounds/center are only written by finalise_bounds.
            self.assertNotIn("bounds", meta)
            self.assertNotIn("center", meta)
        finally:
            conn.close()

    def test_insert_tile_applies_tms_y_flip(self):
        conn = create_mbtiles(self.path, "t", "")
        try:
            z, x, y = 12, 100, 0
            insert_tile(conn, z, x, y, b"PNGDATA")
            row = conn.execute(
                "SELECT zoom_level, tile_column, tile_row, tile_data FROM tiles"
            ).fetchone()
            self.assertEqual(row[0], z)
            self.assertEqual(row[1], x)
            # XYZ y=0 (top) → TMS row = 2^z - 1 (top in TMS).
            self.assertEqual(row[2], (2 ** z - 1) - y)
            self.assertEqual(bytes(row[3]), b"PNGDATA")
        finally:
            conn.close()

    def test_insert_tile_unique_index_replaces(self):
        conn = create_mbtiles(self.path, "t", "")
        try:
            insert_tile(conn, 12, 1, 1, b"first")
            insert_tile(conn, 12, 1, 1, b"second")
            rows = conn.execute("SELECT tile_data FROM tiles").fetchall()
            self.assertEqual(len(rows), 1)
            self.assertEqual(bytes(rows[0][0]), b"second")
        finally:
            conn.close()

    def test_finalise_bounds_rounds_and_centres(self):
        conn = create_mbtiles(self.path, "t", "")
        try:
            finalise_bounds(conn, 150.1234567, -33.7654321, 150.5, -33.4)
            meta = dict(conn.execute("SELECT name, value FROM metadata"))
            self.assertEqual(meta["bounds"], "150.123457,-33.765432,150.5,-33.4")
            cx = round((150.123457 + 150.5) / 2, 6)
            cy = round((-33.765432 + -33.4) / 2, 6)
            self.assertEqual(meta["center"], f"{cx},{cy},{(ZOOM_MIN + ZOOM_MAX) // 2}")
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
