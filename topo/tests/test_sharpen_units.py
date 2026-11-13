"""A survey in feet or in degrees (sharpen.py): the cell a DEM reports, the
ground a DEM or a point cloud gives, in metres whatever the survey measured.

Everything downstream of the Ground step (the zoom, TIN_BUFFER_M, the TIN's
resolution and longest edge, the footprint's simplification) is in metres, so
the Ground step is where a survey is made metric. The `Real` tests use GDAL and
skip on a host without it; the `topo-e2e` job runs them in the worker image
(infra/scripts/check-required-checks.py requires this file there, and the
step fails on a skip).

Mutations that turn each red are named on its class.
"""

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

_REAL_GDAL = not _native_stub.is_stubbed("osgeo")

# A unit's name comes from the upload, so a sentence never quotes it.
LEAK = "Kanangra Walls Survey"

US_FOOT = 1200 / 3937
FOOT = 0.3048

# What `pdal info --summary` reports as `srs` (PDAL 2.6.2), for one window of a
# published USGS point cloud, cut to metres (METRIC), to State Plane Utah
# Central in US survey feet with no vertical CRS (US_FEET) and with one
# (US_FEET_COMPOUND), to degrees (DEGREES), and to metres with its Z in feet
# and a vertical CRS saying so (METRES_OVER_FEET). A file with no vertical CRS
# reports "" for the vertical, and its Z is in the horizontal unit; a
# geographic one reports its horizontal unit as "unknown". METRES_OVER_FEET
# is the one PDAL gets wrong: `units.vertical` says "metre" beside a `vertical`
# WKT in feet, so the WKT is what is read. A file with no CRS at all has no
# `srs` key.
VERTICAL_FTUS = (
    'VERT_CS["NAVD88 height (ftUS)",VERT_DATUM["North American Vertical Datum '
    '1988",2005,AUTHORITY["EPSG","5103"]],UNIT["US survey foot",0.304800609601219,'
    'AUTHORITY["EPSG","9003"]],AXIS["Gravity-related height",UP],'
    'AUTHORITY["EPSG","6360"]]'
)
METRIC = {
    "units": {"horizontal": "metre", "vertical": ""},
    "isgeographic": False,
    "vertical": "",
}
US_FEET = {
    "units": {"horizontal": "US survey foot", "vertical": ""},
    "isgeographic": False,
    "vertical": "",
}
US_FEET_COMPOUND = {
    "units": {"horizontal": "US survey foot", "vertical": "US survey foot"},
    "isgeographic": False,
    "vertical": VERTICAL_FTUS,
}
METRES_OVER_FEET = {
    "units": {"horizontal": "metre", "vertical": "metre"},
    "isgeographic": False,
    "vertical": VERTICAL_FTUS,
}
DEGREES = {
    "units": {"horizontal": "unknown", "vertical": ""},
    "isgeographic": True,
    "vertical": "",
}


class TestCellMetres(unittest.TestCase):
    """Mutations that turn each test red: `a_metre_cell_is_itself`: a cell in
    metres taken as degrees (`linear_m is not None` made `linear_m != 1.0`);
    `a_foot_cell`: a cell returned in its own units (the old `dem_cell`), or a
    US survey foot read as the international one; `a_degree_cell`: the
    east-west size not shrunk with latitude, or the north-south size ignored;
    `the_zoom_a_cell_supports`: a cell returned in its own units."""

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
    """Mutations that turn each test red: `the_names_pdal_and_gdal_give`: a
    name matched case-sensitively, or "US survey foot" taken as the
    international foot; `an_unknown_unit_is_refused`: an unknown unit taken as
    metres, or its name put into the `CannotSharpen` sentence (it is the
    upload's text, which the log must not carry)."""

    def test_the_names_pdal_and_gdal_give(self):
        for name in ("metre", "meter", "m", "Metre", "metres"):
            self.assertEqual(sharpen.linear_unit_m(name), 1.0, name)
        for name in ("foot", "ft", "international foot", "Foot"):
            self.assertEqual(sharpen.linear_unit_m(name), FOOT, name)
        for name in ("US survey foot", "us-ft", "US Survey Foot", "ftUS"):
            self.assertEqual(sharpen.linear_unit_m(name), US_FOOT, name)

    def test_an_unknown_unit_is_refused_without_quoting_it(self):
        # The sentence is logged and stored: text from the upload stays out.
        with self.assertRaises(CannotSharpen) as raised:
            sharpen.linear_unit_m(LEAK)
        self.assertNotIn(LEAK, str(raised.exception))
        self.assertNotIn("Kanangra", str(raised.exception))


class TestCloudUnits(unittest.TestCase):
    """The unit decision from a point cloud's `srs`. Mutations that turn each
    test red: `a_metric_cloud_needs_nothing`: a metric tile reprojected (its
    early `return None` removed; NSW's bytes would change);
    `a_file_with_no_crs`: a file with no `srs` refused or reprojected;
    `a_vertical_unit_that_is_not_named`: a vertical "" taken as metres when the
    horizontal is in feet; `the_vertical_wkt`: the height unit read from
    `units.vertical` instead of the `vertical` WKT (METRES_OVER_FEET);
    `degrees_have_no_horizontal_metres` and `degrees_are_reprojected`: a
    geographic cloud's horizontal unit read by name (`unknown` is then refused
    as a unit); `an_unknown_horizontal_unit`: it read as metres, or its name put
    into the `CannotSharpen` sentence; `utm_zone_of_a_point`: the zone number
    off by one, or the hemisphere offsets swapped; `feet_are_reprojected`: the Z
    scale left off; `metres_over_feet_is_reprojected_too`: the reprojection
    left off a cloud whose Z alone is in feet (its heights are scaled twice
    downstream); `feet_over_metres`: the Z scale applied when only the
    horizontal is in feet."""

    def test_a_metric_cloud_needs_nothing(self):
        self.assertEqual(sharpen.cloud_units(METRIC), (1.0, 1.0))
        self.assertIsNone(sharpen.metre_filters(METRIC, 32756))

    def test_a_file_with_no_crs_is_read_as_metres(self):
        # `pdal info --summary` of a LAS file written with no SRS has no `srs`.
        self.assertEqual(sharpen.cloud_units(None), (1.0, 1.0))
        self.assertEqual(sharpen.cloud_units({}), (1.0, 1.0))
        self.assertIsNone(sharpen.metre_filters({}, 32756))

    def test_a_vertical_unit_that_is_not_named_is_the_horizontal_one(self):
        self.assertEqual(sharpen.cloud_units(US_FEET), (US_FOOT, US_FOOT))

    def test_the_vertical_wkt_gives_the_height_unit(self):
        flat, z = sharpen.cloud_units(US_FEET_COMPOUND)
        self.assertEqual(flat, US_FOOT)
        self.assertAlmostEqual(z, US_FOOT, places=9)
        # PDAL says "metre" in units.vertical here; the WKT says feet.
        flat, z = sharpen.cloud_units(METRES_OVER_FEET)
        self.assertEqual(flat, 1.0)
        self.assertAlmostEqual(z, US_FOOT, places=9)

    def test_degrees_have_no_horizontal_metres(self):
        self.assertEqual(sharpen.cloud_units(DEGREES), (None, 1.0))

    def test_an_unknown_horizontal_unit_is_refused(self):
        srs = {
            "units": {"horizontal": LEAK, "vertical": ""},
            "isgeographic": False,
        }
        for decide in (sharpen.cloud_units, lambda s: sharpen.metre_filters(s, 32756)):
            with self.assertRaises(CannotSharpen) as raised:
                decide(srs)
            self.assertNotIn("Kanangra", str(raised.exception))

    def test_utm_zone_of_a_point(self):
        self.assertEqual(sharpen.utm_epsg(-112.95, 37.28), 32612)
        self.assertEqual(sharpen.utm_epsg(150.3, -33.7), 32756)
        self.assertEqual(sharpen.utm_epsg(-179.9, 10), 32601)
        self.assertEqual(sharpen.utm_epsg(179.9, -10), 32760)

    def test_feet_are_reprojected_to_the_zone_and_scaled_in_z(self):
        names, options = sharpen.metre_filters(US_FEET, 32612)
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

    def test_metres_over_feet_is_reprojected_too(self):
        # The reprojection rewrites the header with no vertical part; a header
        # left with feet in it makes GDAL's warp scale the heights a second time.
        names, options = sharpen.metre_filters(METRES_OVER_FEET, 32612)
        self.assertEqual(names, ["reprojection", "transformation"])
        self.assertIn("--filters.reprojection.out_srs=EPSG:32612", options)

    def test_feet_over_metres_is_not_scaled_in_z(self):
        srs = {
            "units": {"horizontal": "foot", "vertical": "metre"},
            "isgeographic": False,
            "vertical": 'VERT_CS["h",VERT_DATUM["d",2005],UNIT["metre",1]]',
        }
        names, _ = sharpen.metre_filters(srs, 32612)
        self.assertEqual(names, ["reprojection"])

    def test_degrees_are_reprojected(self):
        names, options = sharpen.metre_filters(DEGREES, 32612)
        self.assertEqual(names, ["reprojection"])
        self.assertIn("--filters.reprojection.out_srs=EPSG:32612", options)


class TestSurveyZone(unittest.TestCase):
    """Mutations that turn each test red: `the_zone_is_the_surveys`: the zone
    taken from the first tile alone, or per tile (a survey across a zone edge
    is cut in two grids); `a_survey_of_metric_tiles`: metric tiles given a
    zone; `a_tile_with_z_in_feet`: a tile with Z in feet left out of it;
    `the_southern_hemisphere`: the hemisphere read from the longitude, or the
    southern offset (32700) dropped."""

    def zone(self, summaries, lonlats):
        by_id = {id(s): ll for s, ll in zip(summaries, lonlats)}
        with mock.patch.object(
            sharpen, "lonlat_of", side_effect=lambda s: by_id[id(s)]
        ):
            return sharpen.survey_zone(summaries)

    def test_a_survey_of_metric_tiles_has_no_zone(self):
        summaries = [{"srs": METRIC}, {"srs": {}}]
        self.assertIsNone(self.zone(summaries, [(150, -34)] * 2))

    def test_the_zone_is_the_surveys_not_a_tiles(self):
        summaries = [{"srs": US_FEET}, {"srs": US_FEET}, {"srs": US_FEET}]
        # One tile west of the zone 11/12 edge (-114°), two east of it.
        zone = self.zone(summaries, [(-114.1, 37), (-113.95, 37), (-113.9, 37)])
        self.assertEqual(zone, 32612)
        # The mean decides, not the first tile.
        zone = self.zone(summaries[::-1], [(-113.9, 37), (-113.95, 37), (-114.1, 37)])
        self.assertEqual(zone, 32612)

    def test_a_tile_with_z_in_feet_has_a_zone(self):
        self.assertEqual(
            self.zone([{"srs": METRES_OVER_FEET}], [(-112.9, 37.3)]), 32612
        )

    def test_the_southern_hemisphere_has_its_own_zones(self):
        self.assertEqual(self.zone([{"srs": US_FEET}], [(150.3, -33.7)]), 32756)


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


@unittest.skipIf(not _REAL_GDAL, "needs GDAL")
class TestRealDem(unittest.TestCase):
    """`dem_cell` and `dem_ground` on small made-up GeoTIFFs. Mutations that
    turn each test red: `a_degree_dem` and `a_foot_dem_is_judged`: the cell
    read from the geotransform alone; `a_dem_with_no_crs_is_read_as_metres`: a
    DEM with no CRS read as degrees (`_grid_unit` returning None for it);
    `..._and_heights_in_feet_is_only_scaled`: the `dstSRS` guard for a DEM with
    no CRS removed; `a_metric_dem_passes_through`: a metric DEM warped (the
    early return removed); `a_foot_dem_becomes_metres`: a DEM in feet or
    degrees left in its own CRS, heights left in feet, or the nodata scaled
    with the heights; `a_dem_in_metres_with_heights_in_feet`: heights left in
    feet; `a_dem_with_a_vertical_crs_in_feet`: scaled by hand and by the warp
    (`srcSRS` or `StripVertical` removed); `a_degree_dem_becomes_metres`: left
    in degrees; `an_unknown_band_unit_on_a_metric_dem`: refused;
    `an_unknown_band_unit_on_a_dem_in_feet`: taken as metres, or its name put
    into the `CannotSharpen` sentence; `no_band_unit_has_heights_in_feet`: a
    missing band unit read as metres on a grid in feet;
    `the_dems_of_a_survey_share_one_zone`: the zone left out of `dem_ground`'s
    call to `metric_dem`, or taken per DEM."""

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
        # 3.2808 ftUS is ~1 m, in EPSG:3566 (NAD83 / Utah Central, ftUS).
        path = self.dem(
            "ft.tif",
            "EPSG:3566",
            (1_650_000.0, 3.2808, 0, 4_400_000.0, 0, -3.2808),
            np.ones((8, 8)),
        )
        self.assertAlmostEqual(sharpen.dem_cell(path), 3.2808 * US_FOOT, places=6)

    def bare(self, name, band_unit=None):
        from osgeo import gdal

        path = self.dir / name
        ds = gdal.GetDriverByName("GTiff").Create(str(path), 4, 4, 1, gdal.GDT_Float32)
        ds.SetGeoTransform((0, 2, 0, 0, 0, -2))
        if band_unit:
            ds.GetRasterBand(1).SetUnitType(band_unit)
        ds.GetRasterBand(1).WriteArray(np.ones((4, 4), dtype=np.float32) * 100)
        ds = None
        return path

    def test_a_dem_with_no_crs_and_heights_in_feet_is_only_scaled(self):
        ds = self.ground([self.bare("bare-ft.tif", "ft")])
        self.assertEqual(ds.GetGeoTransform(), (0, 2, 0, 0, 0, -2))
        np.testing.assert_allclose(
            ds.GetRasterBand(1).ReadAsArray(), 100 * FOOT, atol=1e-3
        )

    def test_a_dem_with_no_crs_is_read_as_metres(self):
        path = self.bare("bare.tif")
        self.assertEqual(sharpen.dem_cell(path), 2.0)
        self.assertEqual(self.ground([path]).GetGeoTransform(), (0, 2, 0, 0, 0, -2))

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
        # Not warped, not even by an identity warp that would leave both the
        # same: the DEM itself comes back and nothing is written.
        out = self.dir / "metric.tif"
        self.assertIs(sharpen.metric_dem(path, out), path)
        self.assertFalse(out.exists())

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

    def test_a_dem_with_a_vertical_crs_in_feet_is_scaled_once(self):
        # GDAL's warp scales heights by a vertical CRS's unit by itself: a DEM
        # whose CRS says feet must be scaled once, and leave with no vertical CRS.
        path = self.dem(
            "cf.tif",
            "EPSG:32612+6360",
            (330_000.0, 1, 0, 4_130_000.0, 0, -1),
            np.full((8, 8), 100.0),
        )
        ds = self.ground([path])
        from osgeo import osr

        self.assertFalse(osr.SpatialReference(wkt=ds.GetProjection()).IsCompound())
        np.testing.assert_allclose(
            ds.GetRasterBand(1).ReadAsArray(), 100 * US_FOOT, atol=1e-3
        )
        # And a later warp, as the block worker's, does not scale it again.
        from osgeo import gdal

        warped = gdal.Warp("", ds, format="MEM", dstSRS="EPSG:3857")
        grid = warped.GetRasterBand(1).ReadAsArray()
        np.testing.assert_allclose(grid[grid > -9000], 100 * US_FOOT, atol=1e-3)

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

    def test_an_unknown_band_unit_on_a_metric_dem_is_read_as_metres(self):
        values = np.arange(64, dtype=np.float32).reshape(8, 8)
        path = self.dem(
            "odd.tif",
            "EPSG:32612",
            (330_000.0, 1, 0, 4_130_000.0, 0, -1),
            values,
            band_unit="furlong",
        )
        ds = self.ground([path])
        self.assertEqual(ds.GetRasterBand(1).ReadAsArray().tolist(), values.tolist())

    def test_an_unknown_band_unit_on_a_dem_in_feet_is_refused(self):
        path = self.dem(
            "odd.tif",
            "EPSG:3566",
            (1_650_000.0, 3.2808, 0, 4_400_000.0, 0, -3.2808),
            np.ones((8, 8)),
            band_unit=LEAK,
        )
        with self.assertRaises(CannotSharpen) as raised:
            self.ground([path])
        self.assertNotIn("Kanangra", str(raised.exception))

    def test_a_dem_in_feet_with_no_band_unit_has_heights_in_feet(self):
        path = self.dem(
            "ft.tif",
            "EPSG:3566",
            (1_650_000.0, 3.2808, 0, 4_400_000.0, 0, -3.2808),
            np.full((40, 40), 1000.0),
        )
        ds = self.ground([path])
        grid = ds.GetRasterBand(1).ReadAsArray()
        np.testing.assert_allclose(grid[grid != -9999], 1000 * US_FOOT, atol=0.01)

    def test_the_dems_of_a_survey_share_one_zone(self):
        # Either side of the zone 11/12 edge at -114°.
        west = self.dem(
            "w.tif",
            "EPSG:4326",
            (-114.0004, 1e-5, 0, 37.3, 0, -1e-5),
            np.full((30, 30), 1000.0),
        )
        east = self.dem(
            "e.tif",
            "EPSG:4326",
            (-113.9996, 1e-5, 0, 37.3, 0, -1e-5),
            np.full((30, 30), 1000.0),
        )
        self.assertEqual(sharpen.dem_zone([west, east]), 32612)
        # Each alone is in zone 11 (west) and zone 12 (east): if dem_ground did
        # not hand them the survey's zone, the mosaic would span two CRSs.
        from osgeo import osr

        ds = self.ground([west, east])
        srs = osr.SpatialReference(wkt=ds.GetProjection())
        self.assertEqual(srs.GetAuthorityCode(None), "32612")


class TestCloudGround(unittest.TestCase):
    """The class 2 and SMRF reads of a tile in feet, PDAL mocked. Mutations that
    turn each test red: `a_metric_tile_is_read_unconverted` and
    `smrf_reads_a_metric_tile_unconverted`: any stage or option added to a
    metric tile's (or a file with no CRS's) command; `a_tile_in_feet_is_
    converted`: the conversion left off the class 2 read, or the tile's own
    bounds (feet) handed to the TIN; `smrf_reads_a_tile_in_feet`: the
    conversion left off the SMRF read; `smrf_output_is_not_scaled_twice`: the
    SMRF output converted again by the class 2 read (the ground then comes out
    3.28 times too low); `a_survey_across_a_zone_edge`: the tiles of a survey
    reprojected to a zone each."""

    def run_class2(self, srs, converted_bounds=None):
        calls = []

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
            made = {
                "bounds": {"minx": 1, "maxx": 6562, "miny": 1, "maxy": 6562},
                "num_points": 10,
            }
            return {**made, "srs": srs} if srs is not None else made

        with (
            tempfile.TemporaryDirectory() as tmp,
            mock.patch.object(
                sharpen, "run", side_effect=lambda *c: calls.append(c) or ""
            ),
            mock.patch.object(sharpen, "las_summary", side_effect=summary),
            mock.patch.object(sharpen, "lonlat_of", return_value=(-112.9, 37.3)),
            mock.patch.object(sharpen.pipeline, "_write_progress"),
        ):
            summaries = [sharpen.las_summary("a.laz")]
            zone = sharpen.survey_zone(summaries)
            tiles = sharpen.class2_tiles(["a.laz"], Path(tmp), "", 1, summaries, zone)
        return [" ".join(c) for c in calls], tiles, [list(c) for c in calls]

    def test_a_metric_tile_is_read_unconverted(self):
        for srs in (METRIC, None):
            calls, tiles, commands = self.run_class2(srs)
            (words,) = commands
            self.assertEqual(
                words,
                [
                    "pdal",
                    "translate",
                    "a.laz",
                    words[3],
                    "range",
                    "--filters.range.limits=Classification[2:2]",
                    "--readers.las.start=0",
                    "--readers.las.count=10",
                ],
            )
            self.assertEqual(Path(words[3]).name, "ground-0-0.las")
            self.assertEqual(
                tiles[0][1], {"minx": 1, "maxx": 6562, "miny": 1, "maxy": 6562}
            )

    def test_a_tile_in_feet_is_converted_before_its_class_2_is_cut(self):
        calls, tiles, _ = self.run_class2(US_FEET)
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

    def smrf_commands(self, srs):
        calls = []
        summary = {"bounds": {"minx": 1, "maxx": 2, "miny": 1, "maxy": 2}}
        if srs is not None:
            summary["srs"] = srs
        with (
            tempfile.TemporaryDirectory() as tmp,
            mock.patch.object(
                sharpen, "run", side_effect=lambda *c: calls.append(c) or ""
            ),
            mock.patch.object(sharpen, "las_summary", return_value=summary),
            mock.patch.object(sharpen, "lonlat_of", return_value=(-112.9, 37.3)),
            mock.patch.object(sharpen.pipeline, "_write_progress"),
        ):
            summaries = [sharpen.las_summary("a.laz")]
            zone = sharpen.survey_zone(summaries)
            sharpen.smrf_classify(["a.laz"], Path(tmp), summaries, zone)
        return [list(c) for c in calls]

    def test_smrf_reads_a_tile_in_feet_in_metres_too(self):
        (words,) = self.smrf_commands(US_FEET)
        self.assertLess(words.index("reprojection"), words.index("smrf"))
        self.assertLess(words.index("transformation"), words.index("smrf"))
        self.assertIn("--filters.reprojection.out_srs=EPSG:32612", words)

    def test_smrf_reads_a_metric_tile_unconverted(self):
        for srs in (METRIC, None):
            (words,) = self.smrf_commands(srs)
            self.assertEqual(
                words,
                [
                    "pdal",
                    "translate",
                    "a.laz",
                    words[3],
                    "range",
                    "assign",
                    "smrf",
                    "--filters.range.limits=Classification![7:7],"
                    "Classification![12:12],Classification![18:18]",
                    "--filters.assign.assignment=Classification[:]=0",
                ],
            )
            self.assertEqual(Path(words[3]).name, "smrf-0.las")

    def laz_ground(self, srs_of, lonlats, classes):
        """`laz_ground` on tiles a.laz and b.laz with PDAL mocked: `srs_of(tile)`
        is a tile's `srs` (a file SMRF wrote keeps the header of its input, as
        PDAL 2.6.2 does when Z alone is scaled), `lonlats[tile]` its centre, and
        `classes` is "class-2" or "smrf" (no class 2 in the survey). Returns
        the PDAL translate commands."""
        from concurrent.futures import ThreadPoolExecutor

        calls = []
        bounds = {"minx": 0, "maxx": 2000, "miny": 0, "maxy": 2000}

        def summary(path):
            name = Path(path).name
            if name in ("a.laz", "b.laz"):
                tile = name[0]
                return {
                    "bounds": bounds,
                    "num_points": 6_000_000,
                    "srs": srs_of(tile),
                    "tile": tile,
                }
            has_ground = classes == "class-2" or "smrf" in name
            points = 5_000_000 if has_ground or name.startswith("smrf-") else 0
            return {"bounds": bounds, "num_points": points, "srs": srs_of("a")}

        with (
            tempfile.TemporaryDirectory() as tmp,
            mock.patch.object(
                sharpen, "run", side_effect=lambda *c: calls.append(c) or ""
            ),
            mock.patch.object(sharpen, "las_summary", side_effect=summary),
            mock.patch.object(
                sharpen, "lonlat_of", side_effect=lambda s: lonlats[s["tile"]]
            ),
            mock.patch.object(sharpen.pipeline, "select_surveys_by_layer") as select,
            mock.patch.object(sharpen, "ProcessPoolExecutor", ThreadPoolExecutor),
            mock.patch.object(sharpen, "_tin_tile", side_effect=lambda job: job[4]),
            mock.patch.object(sharpen.pipeline, "available_memory", return_value=2**34),
            mock.patch.object(sharpen.pipeline, "merge_dem_tiles"),
            mock.patch.object(sharpen.pipeline, "_write_progress"),
        ):
            clouds = [Path(tmp) / "a.laz", Path(tmp) / "b.laz"]
            for cloud in clouds:
                cloud.touch()
            select.return_value = mock.Mock(terrain_tiles=[str(c) for c in clouds])
            sharpen.laz_ground(clouds, "g.tif", Path(tmp), 1)
        return [" ".join(c) for c in calls if "translate" in c]

    def test_smrf_output_is_not_scaled_twice(self):
        # Horizontal metres, Z in feet, no class 2 anywhere: only the SMRF
        # read scales Z. Its output keeps the feet header, so the class 2 read
        # of it must not convert again.
        commands = self.laz_ground(
            lambda tile: METRES_OVER_FEET,
            {"a": (-112.9, 37), "b": (-112.9, 37)},
            "smrf",
        )
        smrf = [c for c in commands if " smrf " in c]
        self.assertEqual(len(smrf), 2)
        self.assertTrue(all("transformation" in c for c in smrf))
        # The class 2 read of what SMRF wrote: SMRF's files are named smrf-N.
        again = [c for c in commands if "/smrf-" in c and "Classification[2:2]" in c]
        self.assertEqual(len(again), 2)
        self.assertFalse([c for c in again if "transformation" in c])
        self.assertFalse([c for c in again if "reprojection" in c])

    def test_a_survey_across_a_zone_edge_is_reprojected_to_one_zone(self):
        commands = self.laz_ground(
            lambda tile: US_FEET, {"a": (-114.1, 37.3), "b": (-113.9, 37.3)}, "class-2"
        )
        zones = {
            w.split("=", 1)[1]
            for c in commands
            for w in c.split()
            if w.startswith("--filters.reprojection.out_srs=")
        }
        self.assertEqual(zones, {"EPSG:32612"})
        self.assertEqual(len([c for c in commands if "reprojection" in c]), 4)


if __name__ == "__main__":
    unittest.main()
