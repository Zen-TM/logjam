"""A survey in feet or in degrees (sharpen.py): the cell a DEM reports, the
ground a DEM or a point cloud gives, in metres whatever the survey measured.

Everything downstream of the Ground step (the zoom, TIN_BUFFER_M, the TIN's
resolution and longest edge, the footprint's simplification) is in metres, so
the Ground step is where a survey is made metric. The `Real` tests use GDAL and
skip on a host without it; the `topo-e2e` job's image has it.

Mutations that turn each red are named on its class.
"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import _native_stub  # noqa: F401,E402

import sharpen  # noqa: E402
from sharpen import CannotSharpen  # noqa: E402

REAL_GDAL = not _native_stub.is_stubbed("osgeo")

US_FOOT = 1200 / 3937
FOOT = 0.3048

# What `pdal info --summary` reports as `srs.units` and `srs.isgeographic`
# (PDAL 2.6.2). METRIC, US_FEET and DEGREES are as it wrote them for one
# window of a published USGS point cloud, cut to metres, to feet (State Plane
# Utah Central, ftUS, with and without a vertical CRS) and to degrees;
# FEET_OVER_METRES is made up. A LAS file with no vertical CRS reports ""
# for the vertical unit and has its Z in the horizontal unit; a geographic
# one reports its horizontal unit as "unknown".
METRIC = {"units": {"horizontal": "metre", "vertical": ""}, "isgeographic": False}
US_FEET = {
    "units": {"horizontal": "US survey foot", "vertical": "US survey foot"},
    "isgeographic": False,
}
FEET_OVER_METRES = {
    "units": {"horizontal": "foot", "vertical": "metre"},
    "isgeographic": False,
}
DEGREES = {"units": {"horizontal": "unknown", "vertical": ""}, "isgeographic": True}


class TestCellMetres(unittest.TestCase):
    """Mutations: a cell returned in its own units (the old `dem_cell`); the
    degree's east-west size not shrunk with latitude; its north-south size
    ignored; a US survey foot read as the international one."""

    def test_a_metre_cell_is_itself(self):
        self.assertEqual(sharpen.cell_metres(2.0, 2.0, 1.0), 2.0)

    def test_a_foot_cell_is_scaled_to_metres(self):
        self.assertAlmostEqual(sharpen.cell_metres(3.0, 3.0, FOOT), 0.9144)
        self.assertAlmostEqual(sharpen.cell_metres(3.0, 3.0, US_FOOT), 3 * 1200 / 3937)
        self.assertNotAlmostEqual(
            sharpen.cell_metres(3.0, 3.0, US_FOOT), sharpen.cell_metres(3.0, 3.0, FOOT)
        )

    def test_a_degree_cell_is_its_ground_size_at_the_latitude(self):
        one_metre_of_latitude = 1 / 111_320
        at_equator = sharpen.cell_metres(
            one_metre_of_latitude, one_metre_of_latitude, None, 0
        )
        self.assertAlmostEqual(at_equator, 1.0, places=3)
        # East-west shrinks to cos(60°); the north-south size is unchanged, and
        # the coarser of the two is the cell.
        at_60 = sharpen.cell_metres(
            one_metre_of_latitude, one_metre_of_latitude, None, 60
        )
        self.assertAlmostEqual(at_60, 1.0, places=3)
        wide = sharpen.cell_metres(
            2 * one_metre_of_latitude, one_metre_of_latitude, None, 60
        )
        self.assertAlmostEqual(wide, 1.0, places=3)
        tall = sharpen.cell_metres(
            one_metre_of_latitude, 3 * one_metre_of_latitude, None, 60
        )
        self.assertAlmostEqual(tall, 3.0, places=3)

    def test_the_zoom_a_cell_supports_follows_its_metres(self):
        # 1e-5° is a metre of ground, not "≤ 1.5 m" by the number alone.
        self.assertEqual(
            sharpen.zoom_for_cell(sharpen.cell_metres(1e-5, 1e-5, None, 37)), 17
        )
        # 6 ft is 1.8 m: z16, where the bare 6 would have been refused as 5 m.
        self.assertEqual(sharpen.zoom_for_cell(sharpen.cell_metres(6, 6, FOOT)), 16)
        # 20 ft of ground is 6 m: no finer than the statewide data.
        self.assertIsNone(sharpen.zoom_for_cell(sharpen.cell_metres(20, 20, FOOT)))


class TestUnitNames(unittest.TestCase):
    """Mutations: an unknown unit taken as metres; "US survey foot" taken as
    the international foot; a name matched case-sensitively."""

    def test_the_names_pdal_and_gdal_give(self):
        for name in ("metre", "meter", "m", "Metre", "metres"):
            self.assertEqual(sharpen.linear_unit_m(name), 1.0, name)
        for name in ("foot", "ft", "international foot", "Foot"):
            self.assertEqual(sharpen.linear_unit_m(name), FOOT, name)
        for name in ("US survey foot", "us-ft", "US Survey Foot", "ftUS"):
            self.assertEqual(sharpen.linear_unit_m(name), US_FOOT, name)

    def test_an_unknown_unit_is_refused_with_its_name(self):
        with self.assertRaises(CannotSharpen) as raised:
            sharpen.linear_unit_m("furlong")
        self.assertIn("furlong", str(raised.exception))


class TestCloudUnits(unittest.TestCase):
    """The unit decision from a point cloud's `srs`. Mutations: a vertical ""
    taken as metres when the horizontal is in feet; a tile in feet or degrees
    passed through; a metric tile reprojected (NSW's bytes would change); the
    Z scale left off, or applied when only the horizontal is in feet; a file
    with no CRS taken as metres."""

    def test_a_metric_cloud_needs_nothing(self):
        self.assertEqual(sharpen.cloud_units(METRIC), (1.0, 1.0))
        self.assertIsNone(sharpen.metre_filters(METRIC, 153.0, -34.0))

    def test_a_vertical_unit_that_is_not_named_is_the_horizontal_one(self):
        self.assertEqual(sharpen.cloud_units(US_FEET), (US_FOOT, US_FOOT))
        self.assertEqual(
            sharpen.cloud_units(
                {"units": {"horizontal": "foot", "vertical": ""}, "isgeographic": False}
            ),
            (FOOT, FOOT),
        )

    def test_a_vertical_unit_of_its_own_is_kept(self):
        self.assertEqual(sharpen.cloud_units(FEET_OVER_METRES), (FOOT, 1.0))

    def test_degrees_have_no_horizontal_metres(self):
        self.assertEqual(sharpen.cloud_units(DEGREES), (None, 1.0))

    def test_no_crs_is_refused_with_a_sentence(self):
        for srs in ({}, {"units": {"horizontal": "", "vertical": ""}}):
            with self.assertRaises(CannotSharpen) as raised:
                sharpen.cloud_units(srs)
            self.assertIn("coordinate system", str(raised.exception))

    def test_utm_zone_of_a_point(self):
        self.assertEqual(sharpen.utm_epsg(-112.95, 37.28), 32612)
        self.assertEqual(sharpen.utm_epsg(150.3, -33.7), 32756)
        self.assertEqual(sharpen.utm_epsg(-179.9, 10), 32601)
        self.assertEqual(sharpen.utm_epsg(179.9, -10), 32760)

    def test_feet_are_reprojected_to_the_zone_of_the_centre_and_scaled_in_z(self):
        # UTM 12 N: easting 330 km, northing 4.13 Mm is near -112.9, 37.3.
        names, options = sharpen.metre_filters(US_FEET, -112.9, 37.3)
        self.assertEqual(names, ["reprojection", "transformation"])
        self.assertIn("--filters.reprojection.out_srs=EPSG:32612", options)
        matrix = [
            o for o in options if o.startswith("--filters.transformation.matrix=")
        ]
        self.assertEqual(len(matrix), 1)
        values = [float(v) for v in matrix[0].split("=", 1)[1].split()]
        self.assertEqual(values[:2] + values[4:6], [1, 0, 0, 1])
        self.assertAlmostEqual(values[10], US_FOOT)
        self.assertEqual(values[15], 1)

    def test_z_is_left_alone_when_only_the_horizontal_is_in_feet(self):
        names, _ = sharpen.metre_filters(FEET_OVER_METRES, -112.9, 37.3)
        self.assertEqual(names, ["reprojection"])

    def test_degrees_are_reprojected_from_their_own_bounds(self):
        names, options = sharpen.metre_filters(DEGREES, -112.9, 37.3)
        self.assertEqual(names, ["reprojection"])
        self.assertIn("--filters.reprojection.out_srs=EPSG:32612", options)


def _write_dem(path, srs, geotransform, values, band_unit=None, nodata=-9999.0):
    from osgeo import gdal, osr

    ref = osr.SpatialReference()
    if srs.startswith("+"):
        ref.ImportFromProj4(srs)
    else:
        ref.SetFromUserInput(srs)
    ds = gdal.GetDriverByName("GTiff").Create(
        str(path), values.shape[1], values.shape[0], 1, gdal.GDT_Float32
    )
    ds.SetGeoTransform(geotransform)
    ds.SetProjection(ref.ExportToWkt())
    band = ds.GetRasterBand(1)
    band.SetNoDataValue(nodata)
    if band_unit:
        band.SetUnitType(band_unit)
    band.WriteArray(values.astype(np.float32))
    ds.FlushCache()
    ds = None


@unittest.skipIf(not REAL_GDAL, "needs GDAL")
class TestRealDem(unittest.TestCase):
    """`dem_cell` and `dem_ground` on small made-up GeoTIFFs. Mutations: the
    cell read from the geotransform alone; a DEM in feet or degrees left in its
    own CRS; heights left in feet; the nodata scaled with the heights; a DEM
    with no CRS taken as metres; a metric DEM warped (its cells would move)."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)

    def dem(self, name, *args, **kwargs):
        path = self.dir / name
        _write_dem(path, *args, **kwargs)
        return path

    def test_a_degree_dem_is_judged_by_its_ground_size(self):
        # ~1 m of latitude a cell, at 37.3°N, in degrees.
        path = self.dem(
            "deg.tif", "EPSG:4326", (-112.9, 1e-5, 0, 37.3, 0, -1e-5), np.ones((8, 8))
        )
        cell = sharpen.dem_cell(path)
        self.assertAlmostEqual(cell, 1.11, delta=0.02)
        self.assertEqual(sharpen.zoom_for_cell(cell), 17)

    def test_a_foot_dem_is_judged_in_metres(self):
        # 3.2808 ftUS = ~1 m; UTM 12 N in feet (EPSG:3566 is Utah South, ftUS).
        path = self.dem(
            "ft.tif",
            "EPSG:3566",
            (1_650_000.0, 3.2808, 0, 4_400_000.0, 0, -3.2808),
            np.ones((8, 8)),
        )
        self.assertAlmostEqual(sharpen.dem_cell(path), 3.2808 * US_FOOT, places=6)

    def test_a_dem_with_no_crs_is_refused(self):
        from osgeo import gdal

        path = self.dir / "bare.tif"
        ds = gdal.GetDriverByName("GTiff").Create(str(path), 4, 4, 1, gdal.GDT_Float32)
        ds.SetGeoTransform((0, 1, 0, 0, 0, -1))
        ds.GetRasterBand(1).WriteArray(np.ones((4, 4), dtype=np.float32))
        ds = None
        with self.assertRaises(CannotSharpen) as raised:
            sharpen.dem_cell(path)
        self.assertIn("coordinate system", str(raised.exception))

    def ground(self, files):
        out = str(self.dir / "ground.tif")
        sharpen.dem_ground(files, list(range(len(files))), out)
        from osgeo import gdal

        ds = gdal.Open(out)
        self.addCleanup(lambda: None)
        return ds

    def test_a_metric_dem_passes_through_untouched(self):
        values = np.arange(64, dtype=np.float32).reshape(8, 8)
        path = self.dem(
            "m.tif", "EPSG:32612", (330_000.0, 1, 0, 4_130_000.0, 0, -1), values
        )
        ds = self.ground([path])
        self.assertEqual(ds.GetGeoTransform(), (330_000.0, 1, 0, 4_130_000.0, 0, -1))
        self.assertEqual(ds.GetRasterBand(1).ReadAsArray().tolist(), values.tolist())

    def test_a_foot_dem_becomes_metres_in_utm_and_its_heights_too(self):
        values = np.full((40, 40), 3000.0, dtype=np.float32)
        values[0, 0] = -9999.0
        path = self.dem(
            "ft.tif",
            "EPSG:3566",
            (1_650_000.0, 3.2808, 0, 4_400_000.0, 0, -3.2808),
            values,
            band_unit="us-ft",
        )
        ds = self.ground([path])
        from osgeo import osr

        srs = osr.SpatialReference(wkt=ds.GetProjection())
        self.assertEqual(srs.GetAuthorityCode(None), "32612")
        self.assertEqual(srs.GetLinearUnits(), 1.0)
        self.assertAlmostEqual(abs(ds.GetGeoTransform()[1]), 1.0, delta=0.1)
        grid = ds.GetRasterBand(1).ReadAsArray()
        nodata = ds.GetRasterBand(1).GetNoDataValue()
        data = grid[grid != nodata]
        self.assertGreater(data.size, 0)
        np.testing.assert_allclose(data, 3000 * US_FOOT, atol=0.01)
        # The hole stays a hole, and is not scaled into a height.
        self.assertTrue((grid == nodata).any())

    def test_a_dem_in_metres_with_heights_in_feet_is_scaled_only(self):
        values = np.full((8, 8), 100.0, dtype=np.float32)
        path = self.dem(
            "mf.tif",
            "EPSG:32612",
            (330_000.0, 1, 0, 4_130_000.0, 0, -1),
            values,
            band_unit="ft",
        )
        ds = self.ground([path])
        self.assertEqual(ds.GetGeoTransform()[0], 330_000.0)
        np.testing.assert_allclose(
            ds.GetRasterBand(1).ReadAsArray(), 100 * FOOT, atol=1e-3
        )

    def test_a_degree_dem_becomes_metres_in_utm(self):
        path = self.dem(
            "deg.tif",
            "EPSG:4326",
            (-112.9, 1e-5, 0, 37.3, 0, -1e-5),
            np.full((40, 40), 1500.0),
        )
        ds = self.ground([path])
        from osgeo import osr

        srs = osr.SpatialReference(wkt=ds.GetProjection())
        self.assertEqual(srs.GetAuthorityCode(None), "32612")
        self.assertAlmostEqual(abs(ds.GetGeoTransform()[1]), 1.0, delta=0.15)
        grid = ds.GetRasterBand(1).ReadAsArray()
        np.testing.assert_allclose(grid[grid != -9999], 1500.0, atol=0.01)

    def test_an_unknown_height_unit_is_refused(self):
        path = self.dem(
            "odd.tif",
            "EPSG:32612",
            (330_000.0, 1, 0, 4_130_000.0, 0, -1),
            np.ones((8, 8)),
            band_unit="furlong",
        )
        with self.assertRaises(CannotSharpen):
            self.ground([path])


class TestCloudGround(unittest.TestCase):
    """`class2_tiles` and `smrf_classify` on a tile in feet: PDAL mocked.
    Mutations: the tile's own bounds (feet) handed to the TIN; the conversion
    left off the class 2 read or off the SMRF read; added to a metric tile."""

    def run_class2(self, srs, converted_bounds=None):
        calls = []

        def fake_run(*command):
            calls.append(command)
            return ""

        def summary(path):
            name = Path(path).name
            if name.startswith("ground-"):
                bounds = converted_bounds or {
                    "minx": 0,
                    "maxx": 2000,
                    "miny": 0,
                    "maxy": 2000,
                }
                return {"bounds": bounds, "num_points": 10, "srs": METRIC}
            return {
                "bounds": {"minx": 1, "maxx": 6562, "miny": 1, "maxy": 6562},
                "num_points": 10,
                "srs": srs,
            }

        with (
            tempfile.TemporaryDirectory() as tmp,
            mock.patch.object(sharpen, "run", side_effect=fake_run),
            mock.patch.object(sharpen, "las_summary", side_effect=summary),
            mock.patch.object(sharpen, "lonlat_of", return_value=(-112.9, 37.3)),
            mock.patch.object(sharpen.pipeline, "_write_progress"),
        ):
            tiles = sharpen.class2_tiles(["a.laz"], Path(tmp), "", 1)
        return [" ".join(c) for c in calls], tiles

    def test_a_metric_tile_is_read_as_it_always_was(self):
        calls, tiles = self.run_class2(METRIC)
        self.assertEqual(len(calls), 1)
        self.assertNotIn("reprojection", calls[0])
        self.assertNotIn("transformation", calls[0])
        self.assertEqual(
            tiles[0][1], {"minx": 1, "maxx": 6562, "miny": 1, "maxy": 6562}
        )

    def test_a_tile_in_feet_is_converted_before_its_class_2_is_cut(self):
        calls, tiles = self.run_class2(US_FEET)
        (call,) = calls
        words = call.split()
        self.assertLess(words.index("reprojection"), words.index("range"))
        self.assertLess(words.index("transformation"), words.index("range"))
        self.assertIn("--filters.reprojection.out_srs=EPSG:32612", call)
        self.assertIn("--filters.range.limits=Classification[2:2]", call)
        # The TIN works in the converted file's metres, not the tile's feet.
        self.assertEqual(
            tiles[0][1], {"minx": 0, "maxx": 2000, "miny": 0, "maxy": 2000}
        )

    def test_smrf_reads_a_tile_in_feet_in_metres_too(self):
        calls = []

        with (
            tempfile.TemporaryDirectory() as tmp,
            mock.patch.object(
                sharpen, "run", side_effect=lambda *c: calls.append(c) or ""
            ),
            mock.patch.object(
                sharpen,
                "las_summary",
                return_value={
                    "bounds": {"minx": 1, "maxx": 2, "miny": 1, "maxy": 2},
                    "srs": US_FEET,
                },
            ),
            mock.patch.object(sharpen, "lonlat_of", return_value=(-112.9, 37.3)),
            mock.patch.object(sharpen.pipeline, "_write_progress"),
        ):
            sharpen.smrf_classify(["a.laz"], Path(tmp))
        words = list(calls[0])
        self.assertLess(words.index("reprojection"), words.index("smrf"))
        self.assertLess(words.index("transformation"), words.index("smrf"))
        # SMRF's own window and slope are in metres.
        self.assertIn("--filters.reprojection.out_srs=EPSG:32612", words)


if __name__ == "__main__":
    unittest.main()
