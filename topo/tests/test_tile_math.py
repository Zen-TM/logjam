"""Tile maths: WGS84 <-> tile/world-pixel/mercator conversions.

Pure math (no GDAL); osgeo is stubbed by _native_stub so this runs on the host.
"""
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import _native_stub  # noqa: F401,E402  (installs native stubs before import)

try:
    from pipeline import (  # noqa: E402
        TILE_SIZE,
        ZOOM_MIN,
        ZOOM_MAX,
        footprint_tile_coords,
        ground_metres_per_pixel,
        lon_lat_to_tile,
        lonlat_to_world_px,
        tile_bbox_mercator,
        tile_to_bbox,
        tiles_for_bbox,
    )
    _IMPORT_OK = True
except Exception as _exc:  # noqa: BLE001
    _IMPORT_OK = False
    _IMPORT_ERR = _exc

_REAL_SHAPELY = not _native_stub.is_stubbed("shapely")


@unittest.skipUnless(_IMPORT_OK, f"pipeline import failed: {globals().get('_IMPORT_ERR', '?')}")
class TestTileMath(unittest.TestCase):
    def test_lon_lat_to_tile_origin(self):
        # lon=-180, lat≈85.05 (top-left of the web-mercator world) → tile (0,0).
        self.assertEqual(lon_lat_to_tile(-180.0, 85.0511, 0), (0, 0))

    def test_lon_lat_to_tile_zoom1_quadrants(self):
        # Just east/south of the centre falls in the bottom-right quadrant.
        self.assertEqual(lon_lat_to_tile(0.001, -0.001, 1), (1, 1))
        # Just west/north of centre → top-left quadrant.
        self.assertEqual(lon_lat_to_tile(-0.001, 0.001, 1), (0, 0))

    def test_tile_to_bbox_full_world_at_zoom0(self):
        lon_min, lat_min, lon_max, lat_max = tile_to_bbox(0, 0, 0)
        self.assertAlmostEqual(lon_min, -180.0, places=6)
        self.assertAlmostEqual(lon_max, 180.0, places=6)
        self.assertAlmostEqual(lat_max, 85.0511, places=3)
        self.assertAlmostEqual(lat_min, -85.0511, places=3)

    def test_tile_to_bbox_is_inverse_of_lon_lat_to_tile(self):
        # The bbox of a tile, sampled just inside, must map back to that tile.
        for z in (12, 15, 18):
            x, y = lon_lat_to_tile(150.3, -33.5, z)
            lon_min, lat_min, lon_max, lat_max = tile_to_bbox(x, y, z)
            cx = (lon_min + lon_max) / 2
            cy = (lat_min + lat_max) / 2
            self.assertEqual(lon_lat_to_tile(cx, cy, z), (x, y))

    def test_tile_bbox_mercator_corner_signs(self):
        xmin, ymin, xmax, ymax = tile_bbox_mercator(0, 0, 0)
        # Web-mercator world half-extent ≈ 20037508.34 m.
        self.assertAlmostEqual(xmin, -20037508.34, delta=1.0)
        self.assertAlmostEqual(xmax, 20037508.34, delta=1.0)
        self.assertAlmostEqual(ymax, 20037508.34, delta=1.0)
        self.assertAlmostEqual(ymin, -20037508.34, delta=1.0)
        self.assertGreater(xmax, xmin)
        self.assertGreater(ymax, ymin)

    def test_ground_metres_per_pixel_halves_each_zoom(self):
        self.assertAlmostEqual(ground_metres_per_pixel(0), 2 * math.pi * 6378137.0 / TILE_SIZE, places=3)
        for z in range(0, 18):
            self.assertAlmostEqual(
                ground_metres_per_pixel(z) / ground_metres_per_pixel(z + 1), 2.0, places=9
            )

    def test_tiles_for_bbox_single_tile(self):
        # A tiny bbox well inside one tile yields exactly that one tile.
        x, y = lon_lat_to_tile(150.3, -33.5, 16)
        lon_min, lat_min, lon_max, lat_max = tile_to_bbox(x, y, 16)
        eps = (lon_max - lon_min) / 100
        tiles = list(tiles_for_bbox(lon_min + eps, lat_min + eps, lon_max - eps, lat_max - eps, 16))
        self.assertEqual(tiles, [(x, y)])

    def test_tiles_for_bbox_covers_rectangle(self):
        tiles = list(tiles_for_bbox(150.0, -34.0, 150.5, -33.5, 12))
        self.assertGreater(len(tiles), 1)
        # Every covering tile is unique.
        self.assertEqual(len(tiles), len(set(tiles)))

    def test_lonlat_to_world_px_matches_tile_at_integer_points(self):
        # The integer floor of world-pixel/TILE_SIZE must equal lon_lat_to_tile.
        for z in (12, 16, 18):
            wx, wy = lonlat_to_world_px(150.31, -33.49, z)
            self.assertEqual(
                (int(wx // TILE_SIZE), int(wy // TILE_SIZE)),
                lon_lat_to_tile(150.31, -33.49, z),
            )


def _square(lon0, lat0, side=0.02):
    from shapely.geometry import box
    return box(lon0, lat0, lon0 + side, lat0 + side)


@unittest.skipUnless(_IMPORT_OK and _REAL_SHAPELY, "needs real shapely (host stubs it)")
class TestFootprintTileCoords(unittest.TestCase):
    """Processing-side prune: render only tiles intersecting the footprint, per
    connected component, never the union bbox that spans the gap between a
    non-adjacent capture's tiles (the wasted-render fix in generate_all_tiles)."""

    def test_scattered_footprint_skips_the_gap(self):
        from shapely.ops import unary_union
        a = _square(150.00, -33.02)
        b = _square(151.00, -33.02)          # ~1° (~93 km) gap
        geom = unary_union([a, b])
        self.assertEqual(geom.geom_type, "MultiPolygon")

        coords = set(footprint_tile_coords(geom, ZOOM_MIN, ZOOM_MAX))
        coords_a = set(footprint_tile_coords(a, ZOOM_MIN, ZOOM_MAX))
        coords_b = set(footprint_tile_coords(b, ZOOM_MIN, ZOOM_MAX))
        # No gap tiles leak in — kept set is exactly the per-component union.
        self.assertEqual(coords, coords_a | coords_b)

        # Far fewer than naive full-bbox enumeration over the 1° gap.
        lon_min, lat_min, lon_max, lat_max = geom.bounds
        naive = sum(
            1
            for z in range(ZOOM_MIN, ZOOM_MAX + 1)
            for _ in tiles_for_bbox(lon_min, lat_min, lon_max, lat_max, z)
        )
        self.assertLess(len(coords), naive / 5)

    def test_contiguous_footprint_matches_full_bbox(self):
        a = _square(150.00, -33.02)
        b = _square(150.02, -33.02)          # adjacent → single polygon, no gap
        from shapely.ops import unary_union
        geom = unary_union([a, b])
        coords = set(footprint_tile_coords(geom, ZOOM_MIN, ZOOM_MAX))
        lon_min, lat_min, lon_max, lat_max = geom.bounds
        naive = {
            (z, x, y)
            for z in range(ZOOM_MIN, ZOOM_MAX + 1)
            for x, y in tiles_for_bbox(lon_min, lat_min, lon_max, lat_max, z)
        }
        # Contiguous coverage: every bbox tile intersects → prune is a no-op.
        self.assertEqual(coords, naive)


if __name__ == "__main__":
    unittest.main()
