"""Unit tests for the pure pieces of area_export.py: the MGA zone, which steps
a set of layers needs, the credit line, the tiles over a box, and the layer
names, formats and refusal sentence shared/src/areaExport.ts declares, and the
archive reader against one pmtiles itself wrote. The GDAL steps need the worker image, so they are not
run here (topo/AGENTS.md).
"""

import os
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import _native_stub  # noqa: F401,E402

from _native_stub import is_stubbed  # noqa: E402

from area_export import (  # noqa: E402
    CELL_M,
    FORMATS,
    LAYERS,
    LAYERS_BY_FORMAT,
    MBTILES_ZOOMS,
    STYLE_SLOPE_BANDS,
    AreaOutsideNsw,
    credit_line,
    HILLSHADE_FLAT,
    HILLSHADE_MAX_ALPHA,
    hillshade_colours,
    mbtiles_settings,
    mga_epsg,
    mga_extent,
    slope_colours,
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


@unittest.skipUnless(
    not is_stubbed("osgeo"), "needs real GDAL/PROJ (skipped under host stub)"
)
class MgaExtent(unittest.TestCase):
    # Mutation: return the box itself as `around`, or swap floor and ceil, and
    # the rectangle's corners (the box is rotated in MGA) come out no-data.
    def test_the_mosaic_reaches_every_corner_of_the_rectangle(self):
        from osgeo import osr

        box = (150.28, -33.75, 150.36, -33.69)  # Katoomba, zone 56
        epsg = mga_epsg((box[0] + box[2]) / 2)
        rect, around = mga_extent(box, epsg)

        self.assertTrue(all(v % CELL_M == 0 for v in rect), rect)
        west, south, east, north = around
        self.assertTrue(
            west < box[0] and south < box[1] and east > box[2] and north > box[3],
            (around, box),
        )

        wgs84, mga = osr.SpatialReference(), osr.SpatialReference()
        wgs84.ImportFromEPSG(4326)
        mga.ImportFromEPSG(epsg)
        for srs in (wgs84, mga):
            srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        to_mga = osr.CoordinateTransformation(wgs84, mga)
        to_wgs84 = osr.CoordinateTransformation(mga, wgs84)
        for lon, lat in [(x, y) for x in (box[0], box[2]) for y in (box[1], box[3])]:
            x, y, _ = to_mga.TransformPoint(lon, lat)
            self.assertTrue(rect[0] <= x <= rect[2] and rect[1] <= y <= rect[3])
        for x, y in [(x, y) for x in (rect[0], rect[2]) for y in (rect[1], rect[3])]:
            lon, lat, _ = to_wgs84.TransformPoint(x, y)
            self.assertTrue(west <= lon <= east and south <= lat <= north, (lon, lat))


class MbtilesColours(unittest.TestCase):
    """An MBTiles colours its slope through a colour table: a band takes
    fromDeg up to, not including, toDeg."""

    # Mutation: let a band run through toDeg, and a 60° cliff past the last
    # band is drawn in the 50–60 colour.
    def test_a_band_stops_before_its_toDeg(self):
        table = slope_colours(
            [
                {"fromDeg": 40, "toDeg": 50, "colour": "#ff000080"},
                {"fromDeg": 50, "toDeg": 60, "colour": "#0000ffff"},
            ]
        )
        clear, red, blue = (0, 0, 0, 0), (255, 0, 0, 128), (0, 0, 255, 255)
        self.assertEqual(
            [table[d] for d in (39, 40, 49, 50, 59, 60, 255)],
            [clear, red, red, blue, blue, clear, clear],
        )


class HillshadeOverlay(unittest.TestCase):
    """An MBTiles hillshade is see-through, so an app's basemap shows under
    it."""

    # Mutation: draw the shades opaque, as the job pipeline does, and the
    # file hides the basemap; or leave flat ground tinted, and a plain is a
    # grey sheet.
    def test_flat_ground_and_no_data_are_clear_and_slopes_translucent(self):
        table = hillshade_colours()
        self.assertEqual(len(table), 256)
        self.assertEqual(table[0], (0, 0, 0, 0))  # gdaldem's no-data
        self.assertEqual(table[HILLSHADE_FLAT], (0, 0, 0, 0))
        self.assertTrue(
            all(0 < a <= HILLSHADE_MAX_ALPHA < 255 for *_, a in table[1:HILLSHADE_FLAT])
        )
        self.assertTrue(
            all(0 < a <= HILLSHADE_MAX_ALPHA for *_, a in table[HILLSHADE_FLAT + 1 :])
        )

    # Mutation: shade the sunny side black or the shady side white, and the
    # relief reads inside out.
    def test_shadow_is_black_and_light_is_white_deepening_away_from_flat(self):
        table = hillshade_colours()
        self.assertEqual(table[1], (0, 0, 0, HILLSHADE_MAX_ALPHA))
        self.assertEqual(table[255], (255, 255, 255, HILLSHADE_MAX_ALPHA))
        alphas = [a for *_, a in table]
        self.assertEqual(
            alphas[1 : HILLSHADE_FLAT + 1],
            sorted(alphas[1 : HILLSHADE_FLAT + 1], reverse=True),
        )
        self.assertEqual(alphas[HILLSHADE_FLAT:], sorted(alphas[HILLSHADE_FLAT:]))


@unittest.skipUnless(
    not is_stubbed("osgeo"), "needs real GDAL (skipped under host stub)"
)
class HillshadeOfFlatGround(unittest.TestCase):
    # Mutation: get flat ground's shade wrong (truncate it, say), and every
    # plain in the file is a faint grey sheet.
    def test_gdaldem_shades_flat_ground_as_hillshade_flat(self):
        import numpy as np
        from osgeo import gdal

        from pipeline import HILLSHADE_DEFAULTS

        gdal.UseExceptions()
        dem = gdal.GetDriverByName("MEM").Create("", 8, 8, 1, gdal.GDT_Float32)
        dem.SetGeoTransform((0, 5, 0, 0, 0, -5))
        dem.GetRasterBand(1).Fill(300)
        shade = gdal.DEMProcessing(
            "", dem, "hillshade", format="MEM",
            azimuth=HILLSHADE_DEFAULTS["azimuth"],
            altitude=HILLSHADE_DEFAULTS["altitude"],
            zFactor=HILLSHADE_DEFAULTS["zFactor"], computeEdges=True,
        )  # fmt: skip
        values = np.unique(shade.GetRasterBand(1).ReadAsArray())
        self.assertEqual(values.tolist(), [HILLSHADE_FLAT])


@unittest.skipUnless(
    not is_stubbed("osgeo"), "needs real GDAL (skipped under host stub)"
)
class StyledTile(unittest.TestCase):
    # Mutation: warp an RGBA COG of the colours (gdal_translate -expand rgba)
    # instead of the degrees, and a 0° slope comes out opaque black and a
    # band's alpha is lost.
    def test_a_clear_degree_stays_clear_and_a_band_keeps_its_alpha(self):
        import tempfile

        import numpy as np
        from osgeo import gdal, osr

        from area_export import SLOPE_NODATA, styled_tile, value_cog
        from build_nsw_dem import lonlat_to_tile
        from pipeline import tile_to_bbox

        z = 13
        x, y = lonlat_to_tile(150.3, -33.7, z)
        west, south, east, north = tile_to_bbox(x, y, z)
        degrees = np.zeros((512, 512), np.uint8)
        degrees[:, 256:] = 45
        degrees[:256, :] = SLOPE_NODATA
        wgs84 = osr.SpatialReference()
        wgs84.ImportFromEPSG(4326)
        with tempfile.TemporaryDirectory() as tmp:
            source, cog = Path(tmp, "slope.tif"), Path(tmp, "slope-cog.tif")
            dataset = gdal.GetDriverByName("GTiff").Create(
                str(source), 512, 512, 1, gdal.GDT_Byte
            )
            dataset.SetProjection(wgs84.ExportToWkt())
            dataset.SetGeoTransform(
                (west, (east - west) / 512, 0, north, 0, -(north - south) / 512)
            )
            dataset.GetRasterBand(1).WriteArray(degrees)
            dataset = None
            value_cog(source, cog, SLOPE_NODATA)
            colours = np.array(
                slope_colours([{"fromDeg": 40, "toDeg": 50, "colour": "#ffff008c"}]),
                np.uint8,
            )
            tile = np.asarray(styled_tile(cog, colours, z, x, y))
        self.assertEqual(tuple(tile[200, 50]), (0, 0, 0, 0))  # 0°
        self.assertEqual(tuple(tile[200, 200]), (255, 255, 0, 0x8C))  # 45°
        self.assertEqual(tuple(tile[50, 50]), (0, 0, 0, 0))  # no data


class ClipToBox(unittest.TestCase):
    # Mutation: return the tile unclipped, and a z11 tile's contours run past
    # the box, where its slope and hillshade stop.
    def test_only_the_box_is_drawn(self):
        import numpy as np
        from PIL import Image

        from area_export import clip_to_box
        from pipeline import tile_to_bbox

        z, x, y = 11, 1879, 1227
        west, south, east, north = tile_to_bbox(x, y, z)
        # The tile's south-west quarter.
        box = (west - 1, south - 1, (west + east) / 2, (south + north) / 2)
        solid = Image.new("RGBA", (256, 256), (10, 20, 30, 255))
        alpha = np.asarray(clip_to_box(solid, box, z, x, y))[..., 3]
        self.assertEqual(int(alpha[128:, :128].min()), 255)
        self.assertEqual(int(alpha[:128, :].max()), 0)
        self.assertEqual(int(alpha[:, 128:].max()), 0)
        far = (west - 2, south - 2, west - 1, south - 1)
        self.assertEqual(clip_to_box(solid, far, z, x, y).getextrema()[3], (0, 0))


class MbtilesSettings(unittest.TestCase):
    # Mutation: ignore the snapshot's slopeBands, and an MBTiles is coloured
    # with the default bands, not the account's.
    def test_the_snapshots_bands_and_contour_style(self):
        bands = [{"fromDeg": 30, "toDeg": 90, "colour": "#ff000080"}]
        settings = mbtiles_settings(
            {STYLE_SLOPE_BANDS: bands, "contours": {"majorColour": "#112233ff"}}
        )
        self.assertEqual(settings["slope"]["bands"], bands)
        self.assertEqual(settings["contours"]["majorColour"], "#112233ff")

    # Mutation: draw the 10 m lines from z11, and a zoomed-out MBTiles is a
    # brown smear the map never shows.
    def test_contours_step_as_the_map_does(self):
        from build_nsw_dem import CONTOUR_ZOOMS

        major, minor = mbtiles_settings({})["contours"]["zoomBands"]
        self.assertEqual(
            (major["zoomMin"], major["intervalM"]), (CONTOUR_ZOOMS["major"][0], 50)
        )
        self.assertEqual(
            (minor["zoomMin"], minor["intervalM"]), (CONTOUR_ZOOMS["minor"][0], 10)
        )
        self.assertEqual(minor["majorEveryN"], 5)
        # One band at every zoom the file has, no gap and no overlap.
        self.assertEqual(
            (major["zoomMin"], major["zoomMax"] + 1, minor["zoomMax"]),
            (MBTILES_ZOOMS[0], minor["zoomMin"], MBTILES_ZOOMS[1]),
        )


@unittest.skipIf(is_stubbed("numpy") or is_stubbed("PIL"), "needs numpy and Pillow")
class ContoursDrawnFromLines(unittest.TestCase):
    # Mutation: have render_contours_tile ignore `contour_lines` (read its
    # contour_paths only), and an area MBTiles has no contours at all.
    def test_lines_handed_in_are_drawn(self):
        import numpy as np
        from pipeline import render_contours_tile, tile_to_bbox

        west, south, east, north = tile_to_bbox(15032, 9823, 14)
        line = [[west, (south + north) / 2], [east, (south + north) / 2]]
        tile = render_contours_tile(
            {}, (west, south, east, north), 14, mbtiles_settings({}),
            [({"properties": {"elev": 950}}, line)],
        )  # fmt: skip
        self.assertGreater(int(np.asarray(tile)[..., 3].max()), 0)


@unittest.skipUnless(
    not is_stubbed("osgeo"), "needs real GDAL (skipped under host stub)"
)
class ContourTileLines(unittest.TestCase):
    # Mutation: get the inverse mercator wrong (or leave the lines in metres),
    # or drop one of the X/Y/Z open options, and every contour is drawn off
    # its tile.
    def test_a_tiles_lines_come_back_in_lon_lat(self):
        import tempfile

        from osgeo import gdal, ogr, osr

        from area_export import contour_lines

        from build_nsw_dem import lonlat_to_tile
        from pipeline import tile_to_bbox

        gdal.UseExceptions()
        # Well inside one z14 tile (about 2 km wide), so nothing is clipped.
        z = 14
        x, y = lonlat_to_tile(150.3, -33.7, z)
        west, south, east, north = tile_to_bbox(x, y, z)
        lon0, lat0 = (west + east) / 2, (south + north) / 2
        line = [(lon0 - 0.003, lat0), (lon0, lat0 + 0.002), (lon0 + 0.003, lat0)]
        wgs84 = osr.SpatialReference()
        wgs84.ImportFromEPSG(4326)
        wgs84.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        with tempfile.TemporaryDirectory() as tmp:
            src = gdal.GetDriverByName("Memory").Create("", 0, 0, 0, gdal.GDT_Unknown)
            layer = src.CreateLayer("contours", wgs84, ogr.wkbLineString)
            layer.CreateField(ogr.FieldDefn("elev", ogr.OFTInteger))
            feature = ogr.Feature(layer.GetLayerDefn())
            feature.SetField("elev", 950)
            geom = ogr.Geometry(ogr.wkbLineString)
            for lon, lat in line:
                geom.AddPoint_2D(lon, lat)
            feature.SetGeometry(geom)
            layer.CreateFeature(feature)
            gdal.VectorTranslate(
                f"{tmp}/tiles", src, format="MVT",
                datasetCreationOptions=["MINZOOM=14", "MAXZOOM=14", "COMPRESS=NO"],
            )  # fmt: skip
            # A lone file named by index, as fetch_contour_tiles writes it:
            # beside the writer's metadata.json, GDAL would place the tile
            # from its z/x/y path even without the open options.
            lone = Path(tmp, "contours", "0.pbf")
            lone.parent.mkdir()
            lone.write_bytes(Path(tmp, "tiles", f"{z}/{x}/{y}.pbf").read_bytes())
            lines = contour_lines(str(lone), z, x, y)
        self.assertEqual(len(lines), 1)
        props, coords = lines[0]
        self.assertEqual(props["properties"]["elev"], 950)
        for (lon, lat), (want_lon, want_lat) in zip(coords, line):
            self.assertAlmostEqual(lon, want_lon, places=4)
            self.assertAlmostEqual(lat, want_lat, places=4)


def archive_of(tiles, attribution="made up"):
    """A pmtiles archive in memory holding {(z, x, y): bytes}."""
    import io

    from pmtiles.reader import MemorySource
    from pmtiles.tile import Compression, TileType, zxy_to_tileid
    from pmtiles.writer import Writer

    buf = io.BytesIO()
    writer = Writer(buf)
    for zxy in sorted(tiles, key=lambda t: zxy_to_tileid(*t)):
        writer.write_tile(zxy_to_tileid(*zxy), tiles[zxy])
    zooms = [z for z, _, _ in tiles]
    writer.finalize(
        {
            "tile_type": TileType.PNG,
            "tile_compression": Compression.NONE,
            "min_zoom": min(zooms),
            "max_zoom": max(zooms),
            "min_lon_e7": 0,
            "min_lat_e7": 0,
            "max_lon_e7": 0,
            "max_lat_e7": 0,
            "center_zoom": min(zooms),
            "center_lon_e7": 0,
            "center_lat_e7": 0,
        },
        {"attribution": attribution},
    )
    return MemorySource(buf.getvalue())


@unittest.skipIf(is_stubbed("pmtiles"), "needs pmtiles")
class ContourFilesNamedByIndex(unittest.TestCase):
    # Mutation: name the files z/x/y.pbf, and a GDAL error or warning about
    # one puts a tile address, and so the box, in the worker's log.
    def test_no_tile_address_in_a_file_name(self):
        import tempfile

        from area_export import Archive, fetch_contour_tiles
        from build_nsw_dem import lonlat_to_tile

        x, y = lonlat_to_tile(150.3, -33.7, 14)
        tiles = {(14, x, y): b"lines", (13, x >> 1, y >> 1): b"lines"}
        box = (150.299, -33.701, 150.301, -33.699)
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp, "contours")
            files = fetch_contour_tiles(Archive(archive_of(tiles)), box, out)
            self.assertEqual(set(files), set(tiles))
            for path in files.values():
                self.assertEqual(Path(path).read_bytes(), b"lines")
                name = str(Path(path).relative_to(out))
                for number in (x, y, x >> 1, y >> 1):
                    self.assertNotIn(str(number), name)


@unittest.skipIf(
    is_stubbed("pmtiles") or is_stubbed("numpy") or is_stubbed("PIL"),
    "needs pmtiles, numpy and Pillow",
)
class ContoursAlone(unittest.TestCase):
    """Contours alone: the heights say whether the box is in NSW."""

    box = (150.299, -33.701, 150.301, -33.699)

    def export(self, heights_tiles):
        """The metadata of a contours-only MBTiles of the box."""
        import sqlite3
        import tempfile
        from contextlib import closing
        from concurrent.futures import ThreadPoolExecutor
        from unittest import mock

        from area_export import render_mbtiles
        from build_nsw_dem import lonlat_to_tile

        far = lonlat_to_tile(145.0, -30.0, 14)
        archives = {
            "heights": archive_of(heights_tiles),
            "contours": archive_of({(14, *far): b"lines elsewhere"}),
        }
        # Threads: a worker process would import without the test's stubs.
        with (
            tempfile.TemporaryDirectory() as tmp,
            mock.patch("area_export.ProcessPoolExecutor", ThreadPoolExecutor),
        ):
            path = render_mbtiles(archives, self.box, ["contours"], {}, Path(tmp))
            with closing(sqlite3.connect(path)) as db:
                return dict(db.execute("SELECT name, value FROM metadata"))

    # Mutation: treat no contour tiles as outside NSW, and a box on flat NSW
    # ground is refused with "outside NSW". Or drop the attribution row, and
    # the file loses its credit.
    def test_flat_ground_in_nsw_is_an_export_with_its_credit(self):
        from build_nsw_dem import lonlat_to_tile

        inside = lonlat_to_tile(150.3, -33.7, 15)
        meta = self.export({(15, *inside): b"heights"})
        self.assertEqual(meta["attribution"], credit_line(["contours"], "made up"))

    # Mutation: drop the heights check, and a contours-only box outside NSW
    # comes out an empty file instead of the outside-NSW sentence.
    def test_no_heights_is_outside_nsw(self):
        from build_nsw_dem import lonlat_to_tile

        far = lonlat_to_tile(145.0, -30.0, 15)
        with self.assertRaises(AreaOutsideNsw):
            self.export({(15, *far): b"heights"})


class SyncWithShared(unittest.TestCase):
    """shared/src/areaExport.ts is what the API checks a request against, and
    this worker's declarations must say the same."""

    @classmethod
    def setUpClass(cls):
        with open(_AREA_EXPORT_TS, encoding="utf-8") as fh:
            cls.src = fh.read()

    def names(self, pattern: str):
        match = re.search(pattern, self.src, re.DOTALL)
        self.assertIsNotNone(match, f"{pattern} not found in areaExport.ts")
        return tuple(re.findall(r'"([a-z]+)"', match.group("body")))

    # Mutation: add a layer to AREA_EXPORT_LAYERS only, and the API queues a
    # layer this worker refuses.
    def test_layer_names_match(self):
        self.assertEqual(
            self.names(r"AREA_EXPORT_LAYERS = \[(?P<body>[^\]]*)\]"), LAYERS
        )

    # Mutation: add a format to AREA_EXPORT_FORMATS only, or let a GeoTIFF hold
    # contours on one side only, and the API queues an export this worker
    # refuses.
    def test_formats_and_their_layers_match(self):
        self.assertEqual(
            self.names(r"AREA_EXPORT_FORMATS = \[(?P<body>[^\]]*)\]"), FORMATS
        )
        self.assertEqual(
            self.names(r"\bgeotiff: \[(?P<body>[^\]]*)\]"), LAYERS_BY_FORMAT["geotiff"]
        )
        self.assertRegex(self.src, r"\bgpkg: AREA_EXPORT_LAYERS\b")
        self.assertEqual(
            self.names(r"\bmbtiles: \[(?P<body>[^\]]*)\]"), LAYERS_BY_FORMAT["mbtiles"]
        )
        self.assertEqual(LAYERS_BY_FORMAT["gpkg"], LAYERS)
        self.assertEqual(tuple(LAYERS_BY_FORMAT), FORMATS)

    # Mutation: reword one copy of the sentence, and a box past NSW reads
    # differently refused at submit and failed by the worker.
    def test_outside_nsw_sentence_matches(self):
        match = re.search(r"AREA_EXPORT_OUTSIDE_NSW = say`([^`]*)`", self.src)
        self.assertIsNotNone(
            match, "AREA_EXPORT_OUTSIDE_NSW not found in areaExport.ts"
        )
        self.assertEqual(match.group(1), AreaOutsideNsw.SENTENCE)

    # Mutation: rename the key on one side only, and every MBTiles is drawn
    # in the default bands, not the account's.
    def test_the_slope_bands_key_matches(self):
        match = re.search(
            r"function areaExportStyleSnapshot\((?P<body>.*?)\n}\n", self.src, re.DOTALL
        )
        self.assertIsNotNone(match, "areaExportStyleSnapshot not found")
        self.assertRegex(
            match.group("body"),
            rf"\n\s+{STYLE_SLOPE_BANDS}: normalizeUserUiPreferences",
        )


if __name__ == "__main__":
    unittest.main()
