"""Made-up stand-ins for the published statewide archives, for CI's
topo-e2e job, over the z15 tiles of BOX (the sample tile and a margin).
Runs inside the worker image:

  python3 statewide.py OUT_DIR

`nsw-5m.pmtiles` is a plane, `fill_height` of each z15 pixel, far above any
real ground: check.py tells the fill from the survey by it, and because a
plane survives bilinear resampling unchanged, it can say what height every
fill pixel must hold, so fill landing a tile away or flipped shows.
`nsw-5m-slope.pmtiles` is a flat FILL_SLOPE_DEG.
"""

import sys

sys.path.insert(0, "/app")
import dataclasses  # noqa: E402
from pathlib import Path  # noqa: E402

import numpy as np  # noqa: E402

import build_nsw_dem as dem  # noqa: E402
from sharpen import write_pmtiles  # noqa: E402

BOX = (150.25, -33.84, 150.38, -33.72)  # west, south, east, north
X0, Y0 = dem.lonlat_to_tile(BOX[0], BOX[3], 15)
X1, Y1 = dem.lonlat_to_tile(BOX[2], BOX[1], 15)
FILL_BASE_M = 5000.0
# Rise per z15 pixel, steep enough that fill shifted by one zmax pixel is
# caught: across a tile's pixels the shift adds 0.25 m east or 0.1875 m south
# at z17 (a quarter of a z15 pixel), twice that at z16, while the height
# archive's 1/4 m rounding moves a pixel by at most 0.125 m. Whole multiples of
# 1/256 m, so the plane is exact in the terrarium (it peaks near 10 km).
FILL_EAST_M, FILL_SOUTH_M = 1.0, 0.75
# Over the height archive's 1/4 m rounding (at most 0.125 m off).
FILL_TOLERANCE_M = 0.15
FILL_SLOPE_DEG = 3.0


def fill_height(col, row):
    """The plane at z15 pixel (col, row), counted from BOX's north-west tile;
    fractional for a point between pixel centres."""
    return FILL_BASE_M + FILL_EAST_M * col + FILL_SOUTH_M * row


def archive(out: Path, grid_of, layer) -> None:
    rows = []
    for x in range(X0, X1 + 1):
        for y in range(Y0, Y1 + 1):
            grid = grid_of(x, y).astype(np.float32)
            rgb = dem.encode_terrarium(grid, np.ones_like(grid, bool), layer.rounding)
            rows.append((15, x, y, dem.png_bytes(rgb, layer.png_level)))
    meta = {"name": "made up", "format": "png", "minzoom": "15", "maxzoom": "15"}
    write_pmtiles(rows, out, {**meta, "bounds": ",".join(map(str, BOX))})


def plane(x, y):
    i = np.arange(dem.TILE)
    return fill_height(
        (x - X0) * dem.TILE + i[None, :], (y - Y0) * dem.TILE + i[:, None]
    )


if __name__ == "__main__":
    out = Path(sys.argv[1])
    # Stored to the terrarium's own 1/256 m, so the plane is exact.
    exact = dataclasses.replace(dem.HEIGHTS, rounding=1 / 256)
    archive(out / "nsw-5m.pmtiles", plane, exact)
    flat = lambda x, y: np.full((dem.TILE, dem.TILE), FILL_SLOPE_DEG)  # noqa: E731
    archive(out / "nsw-5m-slope.pmtiles", flat, dem.SLOPE)
