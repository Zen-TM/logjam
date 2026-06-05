"""ELVIS ZIP safety (zip-slip / absolute / symlink) and mode detection.

Pure stdlib (zipfile/os); no GDAL. The ELVIS upload is attacker-controlled, so
the safety rejections here guard a real boundary.
"""
import os
import stat
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import _native_stub  # noqa: F401,E402

try:
    from topo_mbtiles import (  # noqa: E402
        MODE_DEM_LAZ,
        MODE_DEM_ONLY,
        MODE_LAZ_ONLY,
        _safe_extract_zip,
        extract_elvis_zip,
    )
    _IMPORT_OK = True
except Exception as _exc:  # noqa: BLE001
    _IMPORT_OK = False
    _IMPORT_ERR = _exc


def _make_zip(path, entries):
    """entries: list of (name, data). Returns the zip path."""
    with zipfile.ZipFile(path, "w") as zf:
        for name, data in entries:
            zf.writestr(name, data)
    return path


@unittest.skipUnless(_IMPORT_OK, f"import failed: {globals().get('_IMPORT_ERR', '?')}")
class TestSafeExtractZip(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.zip = os.path.join(self.dir, "in.zip")
        self.out = os.path.join(self.dir, "out")
        os.makedirs(self.out)

    def test_rejects_parent_traversal(self):
        _make_zip(self.zip, [("../evil.txt", b"x")])
        with self.assertRaises(RuntimeError):
            _safe_extract_zip(self.zip, self.out)

    def test_rejects_absolute_path(self):
        _make_zip(self.zip, [("/etc/passwd", b"x")])
        with self.assertRaises(RuntimeError):
            _safe_extract_zip(self.zip, self.out)

    def test_rejects_symlink_entry(self):
        with zipfile.ZipFile(self.zip, "w") as zf:
            info = zipfile.ZipInfo("link")
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
            zf.writestr(info, "/etc/passwd")
        with self.assertRaises(RuntimeError):
            _safe_extract_zip(self.zip, self.out)

    def test_safe_zip_extracts(self):
        _make_zip(self.zip, [("dem.tif", b"data"), ("sub/cloud.laz", b"pts")])
        _safe_extract_zip(self.zip, self.out)
        self.assertTrue(os.path.exists(os.path.join(self.out, "dem.tif")))
        self.assertTrue(os.path.exists(os.path.join(self.out, "sub", "cloud.laz")))


@unittest.skipUnless(_IMPORT_OK, f"import failed: {globals().get('_IMPORT_ERR', '?')}")
class TestExtractElvisZip(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.zip = os.path.join(self.dir, "in.zip")

    def _extract(self, entries):
        _make_zip(self.zip, entries)
        out = tempfile.mkdtemp(dir=self.dir)
        return extract_elvis_zip(self.zip, out)

    def test_dem_only_mode(self):
        contents = self._extract([("area.tif", b"d")])
        self.assertEqual(contents.mode, MODE_DEM_ONLY)
        self.assertFalse(contents.has_vegetation)
        self.assertEqual(len(contents.dem_files), 1)
        self.assertEqual(contents.las_files, [])

    def test_laz_only_mode(self):
        contents = self._extract([("cloud.laz", b"p")])
        self.assertEqual(contents.mode, MODE_LAZ_ONLY)
        self.assertTrue(contents.has_vegetation)
        self.assertEqual(len(contents.las_files), 1)

    def test_dem_plus_laz_mode(self):
        contents = self._extract([("dem.tif", b"d"), ("cloud.laz", b"p")])
        self.assertEqual(contents.mode, MODE_DEM_LAZ)
        self.assertTrue(contents.has_vegetation)

    def test_derivative_tifs_excluded_from_dem(self):
        # A hillshade-derivative .tif must not count as a usable DEM.
        contents = self._extract([("area_hillshade.tif", b"d"), ("cloud.laz", b"p")])
        self.assertEqual(contents.mode, MODE_LAZ_ONLY)
        self.assertEqual(contents.dem_files, [])

    def test_no_usable_files_raises(self):
        with self.assertRaises(RuntimeError):
            self._extract([("readme.txt", b"hi")])


if __name__ == "__main__":
    unittest.main()
