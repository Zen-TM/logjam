"""Unit tests for build_region_dem.py: Mapterhorn's 512 px WebP tiles cut into
ADR 0030's 256 px PNG tiles one zoom deeper.

Every height here is made up. build_region_dem.py imports sharpen.py, which
imports osgeo, so it is stubbed first (the topo/tests/_native_stub.py
convention).
"""

import argparse
import io
import os
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import _native_stub  # noqa: F401,E402

import build_nsw_dem as dem  # noqa: E402
import build_region_dem as region  # noqa: E402
import sharpen  # noqa: E402


MADE_UP_SOURCE = {"format": "webp", "name": "x", "minzoom": "0", "maxzoom": "6"}


def webp(heights: np.ndarray, alpha=None) -> bytes:
    """What Mapterhorn publishes: terrarium, lossless WebP, 512 px."""
    rgb = dem.encode_terrarium(heights, ~np.isnan(heights), 1 / 32)
    mode, pixels = "RGB", rgb
    if alpha is not None:
        mode, pixels = "RGBA", np.dstack([rgb, alpha])
    out = io.BytesIO()
    Image.fromarray(pixels, mode).save(out, "WEBP", lossless=True)
    return out.getvalue()


def png_heights(png: bytes) -> np.ndarray:
    return dem.decode_terrarium(np.asarray(Image.open(io.BytesIO(png)).convert("RGB")))


def ramp(size: int, top: float = 700.0) -> np.ndarray:
    """A tilted plane, in steps Mapterhorn's z16 can hold (1/32 m)."""
    y, x = np.mgrid[0:size, 0:size]
    return (np.round((top + x * 0.21 + y * 0.43) * 32) / 32).astype(np.float32)


class TestDecodeSource(unittest.TestCase):
    """Mutations that turn it red: the alpha channel ignored (a transparent
    pixel becomes a height); the no-data test dropped (a -32768 m pixel is
    drawn); no-data widened to 0 m (sea, which Mapterhorn writes as exactly
    0 m, is lost)."""

    def test_a_webp_decodes_to_the_heights_it_encoded(self):
        heights = ramp(512)
        np.testing.assert_array_equal(region.decode_source(webp(heights)), heights)

    def test_a_transparent_pixel_is_no_height(self):
        alpha = np.full((512, 512), 255, np.uint8)
        alpha[10, 20] = 0
        got = region.decode_source(webp(ramp(512), alpha))
        self.assertTrue(np.isnan(got[10, 20]))
        self.assertEqual(int(np.isnan(got).sum()), 1)

    def test_the_terrarium_zero_is_no_height(self):
        heights = ramp(512)
        heights[3, 4] = np.nan
        got = region.decode_source(webp(heights))
        self.assertTrue(np.isnan(got[3, 4]))

    def test_sea_is_a_height(self):
        got = region.decode_source(webp(np.zeros((512, 512), np.float32)))
        self.assertEqual(int(np.isnan(got).sum()), 0)
        self.assertEqual(float(got[0, 0]), 0.0)

    def test_a_tile_of_another_size_is_refused(self):
        out = io.BytesIO()
        Image.fromarray(np.zeros((256, 256, 3), np.uint8)).save(out, "WEBP")
        with self.assertRaises(ValueError):
            region.decode_source(out.getvalue())


class TestQuarters(unittest.TestCase):
    """Mutations that turn it red: the east and south quarters swapped; a
    child one zoom too deep or too shallow; the quarters not tiling the
    source (an offset dropped)."""

    def test_each_child_is_its_quarter_of_the_source(self):
        grid = np.zeros((512, 512), np.float32)
        grid[:256, :256], grid[:256, 256:] = 1, 2  # north-west, north-east
        grid[256:, :256], grid[256:, 256:] = 3, 4  # south-west, south-east
        got = {(z, x, y): g for z, x, y, g in region.quarters(16, 5, 7, grid)}
        self.assertEqual(
            {k: float(v.mean()) for k, v in got.items()},
            {(17, 10, 14): 1, (17, 11, 14): 2, (17, 10, 15): 3, (17, 11, 15): 4},
        )
        self.assertTrue(all(g.shape == (256, 256) for g in got.values()))

    def test_the_quarters_put_back_are_the_source(self):
        grid = ramp(512)
        out = np.zeros_like(grid)
        for _, x, y, q in region.quarters(3, 0, 0, grid):
            out[y * 256 : (y + 1) * 256, x * 256 : (x + 1) * 256] = q
        np.testing.assert_array_equal(out, grid)


class TestRounding(unittest.TestCase):
    """Mutation that turns it red: one step at every zoom (terraces in the
    hillshade on 1 m pixels, ADR 0030's update of 2026-10-23); or a quarter
    metre at z17 because a tile's source was 1/32 m."""

    def test_a_quarter_metre_to_z15_then_halved_each_zoom_deeper(self):
        steps = {z: region.rounding_for(z).rounding for z in (8, 13, 15, 16, 17)}
        self.assertEqual(steps, {8: 0.25, 13: 0.25, 15: 0.25, 16: 0.125, 17: 0.0625})

    def test_a_height_is_rounded_to_its_own_zoom(self):
        tile = np.full((256, 256), 100.05, np.float32)
        for z, expected in ((17, 100.0625), (16, 100.0), (15, 100.0)):
            png = next(dem.tiles_of(tile, z, 0, 0, region.rounding_for(z)))[3]
            self.assertEqual(float(png_heights(png)[0, 0]), expected)


class TestTiles(unittest.TestCase):
    """Mutations that turn it red: a box edge not reaching its tile; the
    block of a source tile computed from the wrong zoom (a tile lands in a
    block it is not in)."""

    def test_the_source_tiles_of_a_box(self):
        # z2 is four by four tiles of 90 degrees of longitude.
        box = (-10.0, -10.0, 100.0, 10.0)
        self.assertEqual(
            sorted(region.source_tiles(box, 2)),
            [(x, y) for x in (1, 2, 3) for y in (1, 2)],
        )

    def test_a_box_inside_one_tile_is_one_tile(self):
        self.assertEqual(region.source_tiles((10, 10, 11, 11), 4), [(8, 7)])

    def test_every_source_tile_is_in_the_block_that_holds_it(self):
        # zmax 17 reads z16; a block at z14 is 4 source tiles across.
        tiles = [(x, y) for x in range(62, 66) for y in range(10, 14)]
        blocks = region.blocks_of(tiles, 17, 14)
        self.assertEqual(sorted(blocks), [(15, 2), (15, 3), (16, 2), (16, 3)])
        self.assertEqual(sum(len(v) for v in blocks.values()), len(tiles))
        for (bx, by), group in blocks.items():
            for x, y in group:
                self.assertEqual((x // 4, y // 4), (bx, by))

    def test_a_file_is_chosen_by_zoom_and_by_box(self):
        def item(name, lon, lat, zoom):
            return {
                "url": name,
                "min_lon": lon,
                "max_lon": lon + 5,
                "min_lat": lat,
                "max_lat": lat + 5,
                "min_zoom": zoom[0],
                "max_zoom": zoom[1],
            }

        items = [
            item("planet", -180, -85, (0, 12)),
            item("here-16", 10, 10, (13, 16)),
            item("here-14", 10, 10, (13, 14)),
            item("far-16", 50, 50, (13, 16)),
        ]
        items[0]["max_lon"], items[0]["max_lat"] = 180, 85
        box = (11, 11, 12, 12)
        self.assertEqual(region.files_covering(items, box, 16), ["here-16"])
        self.assertEqual(region.files_covering(items, box, 14), ["here-16", "here-14"])
        self.assertEqual(region.files_covering(items, box, 12), ["planet"])
        self.assertEqual(region.files_covering(items, box, 17), [])


class TestCoarse(unittest.TestCase):
    """Mutations that turn it red: a sibling that is missing counted as 0 m
    (a tile at the box's edge drops to sea level); the parent taken as one
    child instead of the mean."""

    def test_a_parent_is_the_mean_of_its_children_and_no_height_where_none(self):
        level = {
            (0, 0): np.full((256, 256), 100.0, np.float32),
            (1, 0): np.full((256, 256), 200.0, np.float32),
        }
        (z, x, y, png), *rest = list(region.coarse_rows(level, 1, 0))
        self.assertEqual((z, x, y, rest), (0, 0, 0, []))
        got = png_heights(png)
        self.assertTrue((got[:128, :128] == 100).all())
        self.assertTrue((got[:128, 128:] == 200).all())
        self.assertTrue(np.isnan(got[128:]).all())


class FakeSource:
    """Stands in for Mapterhorn's reader: one made-up z16 tile."""

    def __init__(self, tiles):
        self.tiles = tiles

    def get(self, z, x, y):
        return self.tiles.get((z, x, y))


class TestBlock(unittest.TestCase):
    """Mutations that turn it red: a quarter in the wrong place in the block;
    a coarser zoom taken as the mean of the encoded pixels instead of the
    heights; the zoom above a block not the mean of its children."""

    def setUp(self):
        self.addCleanup(region._readers.clear)

    def test_a_block_holds_the_heights_it_was_given_at_every_zoom(self):
        # z17 over a z14 block: z16 source tiles (8, 8) and (9, 8) are the
        # west and east halves of the top of block (2, 2)'s 8 x 8 tiles.
        west, east = ramp(512, 700.0), ramp(512, 900.0)
        region._readers[:] = [
            FakeSource({(16, 8, 8): webp(west), (16, 9, 8): webp(east)})
        ]
        rows, (bx, by, grid) = region.build_block(
            (17, 14, 2, 2, [(8, 8), (9, 8), (8, 9)])  # (8, 9) has no tile
        )
        by_tile = {(z, x, y): png for z, x, y, png in rows}

        # z17: the north-west quarter of the west tile is tile (16, 16).
        got = png_heights(by_tile[(17, 16, 16)])
        expected = np.round(west[:256, :256] * 16) / 16
        np.testing.assert_array_equal(got, expected)
        # And the east tile's south-east quarter is (19, 17).
        got = png_heights(by_tile[(17, 19, 17)])
        np.testing.assert_array_equal(got, np.round(east[256:, 256:] * 16) / 16)

        # z16: the mean of the four heights below each pixel, rounded to 1/8 m.
        mean = west.reshape(256, 2, 256, 2).mean(axis=(1, 3))
        got = png_heights(by_tile[(16, 8, 8)])
        np.testing.assert_array_equal(got, np.round(mean * 8) / 8)

        # Only tiles with a height: four z17 quarters per source tile, two
        # tiles, then two z16, a z15 and the block's z14.
        self.assertEqual(
            sorted(z for z, _, _, _ in rows), [14] + [15] + [16] * 2 + [17] * 8
        )
        self.assertEqual(grid.shape, (256, 256))
        self.assertEqual((bx, by), (2, 2))

    def test_a_block_with_nothing_has_no_tiles(self):
        region._readers[:] = [FakeSource({})]
        rows, (_, _, grid) = region.build_block((17, 14, 2, 2, [(8, 8)]))
        self.assertEqual(rows, [])
        self.assertTrue(np.isnan(grid).all())

    def test_the_first_source_with_the_tile_answers(self):
        region._readers[:] = [FakeSource({}), FakeSource({(16, 1, 1): b"x"})]
        self.assertEqual(region.source_tile(16, 1, 1), b"x")
        self.assertIsNone(region.source_tile(16, 2, 2))


class TestBuild(unittest.TestCase):
    """A whole run over a made-up archive of one z6 tile (a source, as
    Mapterhorn's files are), written to a real PMTiles and read back.
    Mutations that turn it red: `--zmin` ignored; bounds left out (a reader
    then takes the archive for the world); the credit not the archive's
    attribution; the output's zoom not one deeper than the source's."""

    def test_an_archive_comes_out_in_adr_0030_form(self):
        from pmtiles.reader import MmapSource, Reader

        heights = ramp(512)
        sx, sy = dem.lonlat_to_tile(0.75, 42.5, 6)
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "made-up.pmtiles"
            sharpen.write_pmtiles([(6, sx, sy, webp(heights))], src, MADE_UP_SOURCE)
            out = Path(tmp) / "out.pmtiles"
            region.heights(
                argparse.Namespace(
                    bbox="0.5,42,1.0,43",
                    zmax=7,
                    zmin=5,
                    credit="Made up. Public domain.",
                    name="Made up",
                    jobs=1,
                    source=[str(src)],
                    out=str(out),
                )
            )
            with open(out, "rb") as fh:
                reader = Reader(MmapSource(fh))
                header, meta = reader.header(), reader.metadata()
                self.assertEqual((header["min_zoom"], header["max_zoom"]), (5, 7))
                self.assertEqual(meta["attribution"], "Made up. Public domain.")
                self.assertEqual(meta["encoding"], "terrarium")
                west, south, east, north = (float(v) for v in meta["bounds"].split(","))
                self.assertLess(west, 0.5)
                self.assertGreater(east, 1.0)
                self.assertLess(south, 42)
                self.assertGreater(north, 43)
                self.assertLess(east - west, 6)
                # z7 is the four quarters of the z6 tile, as the heights were given.
                tile = png_heights(reader.get(7, 2 * sx, 2 * sy))
                np.testing.assert_array_equal(
                    tile, np.round(heights[:256, :256] * 4) / 4
                )
                # z5 is there, and z7 has no tile off the source.
                self.assertIsNotNone(reader.get(5, sx // 2, sy // 2))
                self.assertIsNone(reader.get(7, 0, 0))

    def test_a_box_with_no_tiles_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "empty.pmtiles"
            sharpen.write_pmtiles([(6, 0, 0, webp(ramp(512)))], src, MADE_UP_SOURCE)
            args = argparse.Namespace(
                bbox="0.5,42,1.0,43",
                zmax=7,
                zmin=5,
                credit="c",
                name="n",
                jobs=1,
                source=[str(src)],
                out=str(Path(tmp) / "out.pmtiles"),
            )
            with self.assertRaises(SystemExit):
                region.heights(args)


if __name__ == "__main__":
    unittest.main()
