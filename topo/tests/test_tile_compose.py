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

    def test_layer_stack_order_follows_composite_order(self):
        # Two fully-opaque layers: hillshade (red) is the base, slope (blue) sits
        # above it in COMPOSITE_LAYER_ORDER. Even when the request lists slope
        # first, the output must be blue (slope over hillshade), not selection
        # order. Guards the bottom→top reorder.
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            alpha_full = np.full((100, 100), 255, np.uint8)
            _make_rgba_cog(work / "hillshade.tif", (255, 0, 0), alpha_full)
            _make_rgba_cog(work / "slope.tif", (0, 0, 255), alpha_full)

            ctx = _make_ctx(work, {
                "hillshade": work / "hillshade.tif",
                "slope": work / "slope.tif",
            })
            # Request order deliberately reversed (slope before hillshade).
            out = render_composite_to_geotiff(ctx, ["slope", "hillshade"])

            ds = gdal.Open(str(out))
            r, g, b, a = [ds.GetRasterBand(i).ReadAsArray() for i in (1, 2, 3, 4)]
            ds = None
            # slope (blue) is topmost → wins everywhere.
            self.assertTrue((b == 255).all())
            self.assertTrue((r == 0).all())
            self.assertTrue((a == 255).all())

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


_REAL_SHAPELY = not _native_stub.is_stubbed("shapely")

import renderers.tile_compose as tc  # noqa: E402
from renderers.context import RenderError  # noqa: E402


def _square_footprint(lon0: float, lat0: float, side: float = 0.02) -> dict:
    """A small axis-aligned square footprint as a GeoJSON Polygon geometry."""
    return {
        "type": "Polygon",
        "coordinates": [[
            [lon0, lat0],
            [lon0 + side, lat0],
            [lon0 + side, lat0 + side],
            [lon0, lat0 + side],
            [lon0, lat0],
        ]],
    }


@unittest.skipUnless(_REAL_SHAPELY, "real shapely required (host stubs it)")
class TestCompositeTileCoords(unittest.TestCase):
    """Guards the non-adjacent-footprint fix: tile enumeration must follow the
    actual footprint geometry per connected component, never the union bbox that
    spans the empty gap between captures (the wallewerang 5h33m blowup)."""

    # Two ~2 km squares ~1° (~93 km) apart — a non-adjacent capture.
    JOB_A = {"id": "a", "footprint": _square_footprint(150.00, -33.02)}
    JOB_B = {"id": "b", "footprint": _square_footprint(151.00, -33.02)}

    def test_scattered_footprint_skips_the_gap(self):
        geom = tc._footprint_geometry([self.JOB_A, self.JOB_B])
        self.assertEqual(geom.geom_type, "MultiPolygon")  # disjoint → multi

        coords = set(tc._composite_tile_coords(geom, tc._max_composite_tiles()))
        self.assertTrue(coords)

        # Kept tiles equal exactly the per-component tiles — no gap tiles leak in.
        coords_a = set(tc._composite_tile_coords(
            tc._footprint_geometry([self.JOB_A]), tc._max_composite_tiles()))
        coords_b = set(tc._composite_tile_coords(
            tc._footprint_geometry([self.JOB_B]), tc._max_composite_tiles()))
        self.assertEqual(coords, coords_a | coords_b)

        # And dramatically fewer than naive full-bbox enumeration (which would
        # iterate every tile across the 1° gap).
        lon_min, lat_min, lon_max, lat_max = geom.bounds
        naive = sum(
            1
            for z in range(tc.ZOOM_MIN, tc.ZOOM_MAX + 1)
            for _ in tc.tiles_for_bbox(lon_min, lat_min, lon_max, lat_max, z)
        )
        self.assertLess(len(coords), naive / 5)

    def test_contiguous_footprint_unchanged(self):
        # Adjacent squares union to one Polygon; every bbox tile is kept (no gap).
        adjacent_b = {"id": "b", "footprint": _square_footprint(150.02, -33.02)}
        geom = tc._footprint_geometry([self.JOB_A, adjacent_b])
        coords = set(tc._composite_tile_coords(geom, tc._max_composite_tiles()))
        lon_min, lat_min, lon_max, lat_max = geom.bounds
        naive = {
            (z, x, y)
            for z in range(tc.ZOOM_MIN, tc.ZOOM_MAX + 1)
            for x, y in tc.tiles_for_bbox(lon_min, lat_min, lon_max, lat_max, z)
        }
        # Contiguous coverage: kept set is the full bbox set (intersect-test keeps
        # every tile), so the fix is a no-op for normal jobs.
        self.assertEqual(coords, naive)

    def test_cap_fails_fast(self):
        geom = tc._footprint_geometry([self.JOB_A, self.JOB_B])
        with self.assertRaises(RenderError):
            tc._composite_tile_coords(geom, max_tiles=1)


if __name__ == "__main__":
    unittest.main()
