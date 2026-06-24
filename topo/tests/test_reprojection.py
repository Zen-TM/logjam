"""Guard: reproject_raster_to_web_mercator turns the rotation wedge into clean
nodata, never fabricated data.

Rasterizing a native MGA/UTM grid and then warping the RASTER to Web Mercator
rotates the axis-aligned square into a quad, leaving triangular gaps at the
output bbox corners. With INIT_DEST=NO_DATA those gaps must stay nodata
(transparent), not be resampled/extrapolated into "spaghetti". This test builds
a fully-valid native MGA56 raster, warps it, and asserts:
  - output CRS is EPSG:3857,
  - the interior survives (a real value, not nodata),
  - the rotated corners are nodata (the wedge is transparent, not fabricated).

Runs a real GDAL warp with PROJ transforms, so it is skipped when osgeo is the
host stub and runs for real inside the worker Docker image.
"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import _native_stub  # noqa: F401,E402  (stubs osgeo when absent on the host)

import numpy as np  # noqa: E402

_REAL_GDAL = not _native_stub.is_stubbed("osgeo")

if _REAL_GDAL:
    from osgeo import gdal, osr  # noqa: E402
    gdal.UseExceptions()
    from pipeline import reproject_raster_to_web_mercator  # noqa: E402

_MGA56_EPSG = 28356
_NODATA = -9999.0
_N = 1000          # 1000 px
_PIX = 2.0         # 2 m → 2 km tile
_EAST0 = 250_000.0
_NORTH0 = 6_250_000.0  # NSW-ish MGA56 coordinates


def _write_native_dtm(path):
    """Fully-valid MGA56 raster (constant elevation), nodata elsewhere (none)."""
    ds = gdal.GetDriverByName("GTiff").Create(path, _N, _N, 1, gdal.GDT_Float32)
    ds.SetGeoTransform((_EAST0, _PIX, 0, _NORTH0, 0, -_PIX))
    srs = osr.SpatialReference(); srs.ImportFromEPSG(_MGA56_EPSG)
    ds.SetProjection(srs.ExportToWkt())
    band = ds.GetRasterBand(1)
    band.SetNoDataValue(_NODATA)
    band.WriteArray(np.full((_N, _N), 100.0, dtype=np.float32))
    ds.FlushCache()
    ds = None


@unittest.skipUnless(_REAL_GDAL, "needs real GDAL/PROJ (skipped under host stub)")
class TestReprojectRasterToWebMercator(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.src = os.path.join(self.tmp, "native.tif")
        self.dst = os.path.join(self.tmp, "merc.tif")
        _write_native_dtm(self.src)
        reproject_raster_to_web_mercator(self.src, self.dst, _NODATA, "cubic")
        self.ds = gdal.Open(self.dst)
        self.arr = self.ds.GetRasterBand(1).ReadAsArray()
        self.nd = self.ds.GetRasterBand(1).GetNoDataValue()

    def test_output_is_web_mercator(self):
        srs = osr.SpatialReference(self.ds.GetProjection())
        self.assertEqual(srs.GetAuthorityCode(None), "3857")

    def test_interior_survives(self):
        cy, cx = self.arr.shape[0] // 2, self.arr.shape[1] // 2
        self.assertAlmostEqual(float(self.arr[cy, cx]), 100.0, delta=1.0)

    def test_rotated_corners_are_nodata_not_fabricated(self):
        # Rotating an axis-aligned square into 3857 leaves the output bbox corners
        # outside the data quad. INIT_DEST=NO_DATA must leave them nodata.
        corners = [self.arr[0, 0], self.arr[0, -1], self.arr[-1, 0], self.arr[-1, -1]]
        self.assertTrue(
            any(c == self.nd for c in corners),
            "no nodata corner — wedge was fabricated instead of left transparent",
        )

    def test_no_data_value_preserved(self):
        self.assertEqual(self.nd, _NODATA)


if __name__ == "__main__":
    unittest.main()
