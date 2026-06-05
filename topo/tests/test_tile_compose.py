"""Tests for the GeoTIFF composite blender in renderers/tile_compose.py.

Guards the alpha-aware Warp chain: two non-overlapping RGBA layers must both
survive composition, and opaque colour-0 pixels must not be dropped. The old
BuildVRT(srcNodata=0) path failed both — it masked the alpha band and treated
black as nodata.

Plain unittest (no pytest dep) so it runs in the worker Docker image as-is.
"""
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import _native_stub  # noqa: F401,E402  (stubs osgeo when absent on the host)

import numpy as np
from osgeo import gdal, osr

# This suite runs a real GDAL Warp; when osgeo is the host stub, the class is
# skipped (it runs for real inside the worker Docker image where GDAL exists).
# The imports still resolve under the stub so module collection succeeds.
_REAL_GDAL = not _native_stub.is_stubbed("osgeo")

from renderers.context import RenderContext
from renderers.tile_compose import render_composite_to_geotiff


def _make_rgba_cog(path: Path, rgb: tuple, alpha_mask: np.ndarray):
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(3857)
    driver = gdal.GetDriverByName("GTiff")
    ds = driver.Create(str(path), 100, 100, 4, gdal.GDT_Byte)
    ds.SetGeoTransform((0, 10, 0, 0, 0, -10))
    ds.SetProjection(srs.ExportToWkt())
    for band_index, value in enumerate(rgb, start=1):
        ds.GetRasterBand(band_index).Fill(value)
    ds.GetRasterBand(4).WriteArray(alpha_mask)
    ds.GetRasterBand(4).SetColorInterpretation(gdal.GCI_AlphaBand)
    ds.FlushCache()
    ds = None


def _make_ctx(work_dir: Path, cog_paths: dict) -> RenderContext:
    job_id = "job-1"
    ctx = RenderContext(
        s3=None,
        bucket="test-bucket",
        work_dir=work_dir,
        source_jobs=[{"id": job_id}],
        layers=list(cog_paths.keys()),
        bundling="composite",
        vector_style={},
    )
    # Pre-seed the download cache so cog_path() returns local files without S3.
    for layer, path in cog_paths.items():
        ctx._cog_paths[f"{job_id}/{layer}.tif"] = path
    return ctx


@unittest.skipUnless(_REAL_GDAL, "real GDAL required (host has no osgeo)")
class TestCompositeGeoTiff(unittest.TestCase):
    def test_two_disjoint_layers_both_survive(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            alpha_left = np.zeros((100, 100), np.uint8)
            alpha_left[:, :50] = 255
            alpha_right = np.zeros((100, 100), np.uint8)
            alpha_right[:, 50:] = 255
            _make_rgba_cog(work / "hillshade.tif", (255, 0, 0), alpha_left)
            _make_rgba_cog(work / "slope.tif", (0, 0, 255), alpha_right)

            ctx = _make_ctx(work, {
                "hillshade": work / "hillshade.tif",
                "slope": work / "slope.tif",
            })
            out = render_composite_to_geotiff(ctx, ["hillshade", "slope"])

            ds = gdal.Open(str(out))
            r, g, b, a = [ds.GetRasterBand(i).ReadAsArray() for i in (1, 2, 3, 4)]
            ds = None

            # Left half = opaque red from layer A.
            self.assertTrue((r[:, :50] == 255).all())
            self.assertTrue((b[:, :50] == 0).all())
            self.assertTrue((a[:, :50] == 255).all())
            # Right half = opaque blue from layer B. The old nodata-masked path
            # dropped these pixels.
            self.assertTrue((b[:, 50:] == 255).all())
            self.assertTrue((r[:, 50:] == 0).all())
            self.assertTrue((a[:, 50:] == 255).all())

    def test_opaque_black_pixels_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            alpha_full = np.full((100, 100), 255, np.uint8)
            _make_rgba_cog(work / "hillshade.tif", (0, 0, 0), alpha_full)

            ctx = _make_ctx(work, {"hillshade": work / "hillshade.tif"})
            out = render_composite_to_geotiff(ctx, ["hillshade"])

            ds = gdal.Open(str(out))
            a = ds.GetRasterBand(4).ReadAsArray()
            ds = None
            # Opaque black must remain opaque, not be treated as nodata.
            self.assertTrue((a == 255).all())


if __name__ == "__main__":
    unittest.main()
