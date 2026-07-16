"""Regression guard: the data footprint must cover the real data extent.

compute_data_footprint() builds the polygon that the tile renderer masks the
hillshade to. The DTM's 1 m ground mask is sparse (~40% of cells carry a ground
return), so a naive nearest-neighbour downsample + tiny morphological close
pulls the footprint well inside the true extent and the renderer then alpha-zeros
real data at the edges (observed: ~17% of a real tile clipped to transparent).

This test builds a synthetic sparse DTM with a KNOWN true extent (a filled disk
populated at ~40% ground density) and asserts the footprint:
  - covers ≥95% of the true extent (does not clip real data), and
  - does not balloon far beyond it (≤115% — fill-fringe trimming still works).

Runs a real GDAL/OGR stack, so it is skipped when osgeo is the host stub and
runs for real inside the worker Docker image.
"""
import os
import sys
import json
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import _native_stub  # noqa: F401,E402  (stubs osgeo when absent on the host)

import numpy as np  # noqa: E402

_REAL_GDAL = not _native_stub.is_stubbed("osgeo")
# compute_data_footprint also runs shapely (mapping/unary_union); a host with
# real GDAL but stubbed shapely would feed MagicMocks into json.dumps.
_REAL_FOOTPRINT_STACK = _REAL_GDAL and not _native_stub.is_stubbed("shapely")

if _REAL_GDAL:
    from osgeo import gdal, ogr, osr  # noqa: E402
    gdal.UseExceptions()
    from pipeline import compute_data_footprint, raster_has_valid_pixels  # noqa: E402

# Synthetic grid: 1 m Web Mercator, origin somewhere over Australia.
# Grid is sized so the disk has > (close radius) of empty margin to every array
# edge, otherwise the morphological-close dilation would clamp against the array
# border and inflate the footprint — an artifact of the tiny synthetic, not the
# real km-scale tiles where data already reaches the raster edge.
_N = 700
_ORIGIN_X = 16_000_000.0
_ORIGIN_Y = -4_000_000.0
_DISK_CX = _DISK_CY = _N / 2.0
_DISK_R = 180.0          # true extent radius, metres (= pixels at 1 m)
_GROUND_DENSITY = 0.40   # fraction of in-disk cells carrying a ground return
_NODATA = -9999.0


def _true_disk_mask():
    yy, xx = np.mgrid[0:_N, 0:_N]
    return ((xx + 0.5 - _DISK_CX) ** 2 + (yy + 0.5 - _DISK_CY) ** 2) <= _DISK_R ** 2


def _write_synthetic_dtm(path):
    """A filled disk populated at ~40% ground density; nodata elsewhere."""
    disk = _true_disk_mask()
    rng = np.random.default_rng(1234)
    sampled = disk & (rng.random((_N, _N)) < _GROUND_DENSITY)
    arr = np.full((_N, _N), _NODATA, dtype=np.float32)
    arr[sampled] = 100.0  # arbitrary elevation
    ds = gdal.GetDriverByName("GTiff").Create(path, _N, _N, 1, gdal.GDT_Float32)
    ds.SetGeoTransform((_ORIGIN_X, 1.0, 0, _ORIGIN_Y, 0, -1.0))
    srs = osr.SpatialReference(); srs.ImportFromEPSG(3857)
    ds.SetProjection(srs.ExportToWkt())
    band = ds.GetRasterBand(1)
    band.SetNoDataValue(_NODATA)
    band.WriteArray(arr)
    ds.FlushCache()
    ds = None


def _rasterize_footprint_to_grid(geojson_path):
    """Burn the WGS84 footprint back onto the synthetic merc grid → bool mask."""
    fp = ogr.Open(geojson_path)
    lyr = fp.GetLayer()
    src_srs = lyr.GetSpatialRef()
    dst_srs = osr.SpatialReference(); dst_srs.ImportFromEPSG(3857)
    src_srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    dst_srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    ct = osr.CoordinateTransformation(src_srs, dst_srs)

    mem = ogr.GetDriverByName("Memory").CreateDataSource("m")
    mlyr = mem.CreateLayer("fp", dst_srs, ogr.wkbPolygon)
    for feat in lyr:
        g = feat.GetGeometryRef().Clone(); g.Transform(ct)
        f2 = ogr.Feature(mlyr.GetLayerDefn()); f2.SetGeometry(g); mlyr.CreateFeature(f2)

    ras = gdal.GetDriverByName("MEM").Create("", _N, _N, 1, gdal.GDT_Byte)
    ras.SetGeoTransform((_ORIGIN_X, 1.0, 0, _ORIGIN_Y, 0, -1.0))
    ras.SetProjection(dst_srs.ExportToWkt())
    gdal.RasterizeLayer(ras, [1], mlyr, burn_values=[1])
    return ras.GetRasterBand(1).ReadAsArray().astype(bool)


@unittest.skipUnless(_REAL_FOOTPRINT_STACK, "needs real GDAL/OGR + shapely (skipped under host stub)")
class TestFootprintCoverage(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.dtm = os.path.join(self.tmp, "dtm.tif")
        self.fp = os.path.join(self.tmp, "footprint.geojson")
        _write_synthetic_dtm(self.dtm)
        compute_data_footprint(self.dtm, self.fp)

    def test_footprint_is_valid_geojson(self):
        with open(self.fp) as f:
            fc = json.load(f)
        self.assertEqual(fc["type"], "FeatureCollection")
        self.assertGreaterEqual(len(fc["features"]), 1)

    def test_covers_true_extent(self):
        true_mask = _true_disk_mask()
        fp_mask = _rasterize_footprint_to_grid(self.fp)
        covered = (true_mask & fp_mask).sum() / true_mask.sum()
        # The whole point of the fix: real (sparse) data must not be clipped.
        self.assertGreaterEqual(
            covered, 0.95,
            f"footprint covers only {covered:.1%} of true extent — clipping real data",
        )

    def test_does_not_balloon(self):
        true_mask = _true_disk_mask()
        fp_mask = _rasterize_footprint_to_grid(self.fp)
        ratio = fp_mask.sum() / true_mask.sum()
        # Trimming the false fill-fringe must still work: no wild over-extension.
        self.assertLessEqual(
            ratio, 1.15,
            f"footprint area is {ratio:.2f}× the true extent — over-extending",
        )


def _write_raster(path, arr, nodata=_NODATA, set_nodata=True):
    """Write a small single-band Float32 GTiff for validity checks."""
    n_y, n_x = arr.shape
    ds = gdal.GetDriverByName("GTiff").Create(path, n_x, n_y, 1, gdal.GDT_Float32)
    ds.SetGeoTransform((_ORIGIN_X, 1.0, 0, _ORIGIN_Y, 0, -1.0))
    srs = osr.SpatialReference(); srs.ImportFromEPSG(3857)
    ds.SetProjection(srs.ExportToWkt())
    band = ds.GetRasterBand(1)
    if set_nodata:
        band.SetNoDataValue(nodata)
    band.WriteArray(arr.astype(np.float32))
    ds.FlushCache()
    ds = None


@unittest.skipUnless(_REAL_GDAL, "needs real GDAL (skipped under host stub)")
class TestRasterHasValidPixels(unittest.TestCase):
    """raster_has_valid_pixels gates the Mode A hard-fail on an all-nodata DEM
    (ELVIS occasionally bundles empty DEM tiles)."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def test_all_nodata_is_invalid(self):
        path = os.path.join(self.tmp, "empty.tif")
        _write_raster(path, np.full((10, 10), _NODATA))
        self.assertFalse(raster_has_valid_pixels(path))

    def test_some_valid_pixels_is_valid(self):
        path = os.path.join(self.tmp, "partial.tif")
        arr = np.full((10, 10), _NODATA)
        arr[3, 3] = 100.0  # a single real elevation is enough
        _write_raster(path, arr)
        self.assertTrue(raster_has_valid_pixels(path))

    def test_all_nan_is_invalid(self):
        # No nodata value set, but every pixel is NaN → still invalid (finite check).
        path = os.path.join(self.tmp, "nan.tif")
        _write_raster(path, np.full((10, 10), np.nan), set_nodata=False)
        self.assertFalse(raster_has_valid_pixels(path))

    def test_missing_file_is_invalid(self):
        self.assertFalse(
            raster_has_valid_pixels(os.path.join(self.tmp, "does_not_exist.tif"))
        )


if __name__ == "__main__":
    unittest.main()
