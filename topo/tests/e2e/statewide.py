"""Made-up stand-ins for the published statewide archives, for CI's
topo-e2e job: `nsw-5m.pmtiles` at a flat FILL_HEIGHT_M and
`nsw-5m-slope.pmtiles` at a flat FILL_SLOPE_DEG, over the z15 tiles of a
box. Values no real ground has, so check.py can tell the fill from the
survey. Runs inside the worker image.

  python3 statewide.py OUT_DIR WEST SOUTH EAST NORTH
"""

import sys

sys.path.insert(0, "/app")
from pathlib import Path  # noqa: E402

import numpy as np  # noqa: E402

import build_nsw_dem as dem  # noqa: E402
from sharpen import write_pmtiles  # noqa: E402

FILL_HEIGHT_M = 5000.0
FILL_SLOPE_DEG = 3.0


def archive(out: Path, value: float, layer, box) -> None:
    west, south, east, north = box
    x0, y0 = dem.lonlat_to_tile(west, north, 15)
    x1, y1 = dem.lonlat_to_tile(east, south, 15)
    grid = np.full((dem.TILE, dem.TILE), value, np.float32)
    rgb = dem.encode_terrarium(grid, np.ones_like(grid, bool), layer.rounding)
    png = dem.png_bytes(rgb, layer.png_level)
    rows = [(15, x, y, png) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]
    write_pmtiles(
        rows,
        out,
        {
            "name": "made up",
            "format": "png",
            "minzoom": "15",
            "maxzoom": "15",
            "bounds": f"{west},{south},{east},{north}",
        },
    )


if __name__ == "__main__":
    out = Path(sys.argv[1])
    box = tuple(float(v) for v in sys.argv[2:6])
    archive(out / "nsw-5m.pmtiles", FILL_HEIGHT_M, dem.HEIGHTS, box)
    archive(out / "nsw-5m-slope.pmtiles", FILL_SLOPE_DEG, dem.SLOPE, box)
