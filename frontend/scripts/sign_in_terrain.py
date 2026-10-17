#!/usr/bin/env python3
"""
The terrain behind Logjam Web's sign-in screen, one area at a time, from the
NSW 5 m DEM sheets. Download the zips an area needs into SHEETS_DIR from
https://portal.spatial.nsw.gov.au/download/dem/56/<Sheet>-DEM-AHD_56_5m.zip
(Katoomba, Wallerawang and Burragorang cover every area here). Needs numpy,
pillow, rasterio and scikit-image.

For each area it writes three files to OUT_DIR:
  <key>.json         its name and centre, and its 100 m contours as SVG path
                     data on a grid 1600 units wide
  <key>Normals.webp  surface normals, which the relief shader lights
  <key>Flow.webp     where water on each cell runs next (D8, lossless)

    sign_in_terrain.py SHEETS_DIR src/assets/signIn [key ...]   # no key = every area
"""

import glob
import heapq
import io
import json
import math
import os
import sys
import zipfile
from itertools import pairwise

import numpy as np
import rasterio
from PIL import Image
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject
from skimage.filters import gaussian
from skimage.measure import approximate_polygon, find_contours

# (name, (south, west, north, east)). Each is 0.14° × 0.09°, about 13 × 10 km,
# framed so what it is named for sits right of centre: on a wide screen the
# sign-in card covers the left third. Names are checked against OpenStreetMap.
AREAS = {
    "grose": ("Grose Valley, Blue Mountains", (-33.66, 150.26, -33.57, 150.40)),
    "narrowNeck": ("Narrow Neck, Blue Mountains", (-33.815, 150.19, -33.725, 150.33)),
    "solitary": (
        "Mount Solitary and the Jamison Valley, Blue Mountains",
        (-33.82, 150.25, -33.73, 150.39),
    ),
    "claustral": (
        "Claustral Canyon and Mount Tomah, Blue Mountains",
        (-33.61, 150.32, -33.52, 150.46),
    ),
    "wollangambe": (
        "Wollangambe River, Blue Mountains",
        (-33.53, 150.30, -33.44, 150.44),
    ),
    "kanangra": (
        "Kanangra Walls and Kanangra Creek, Kanangra-Boyd",
        (-34.016, 150.04, -33.926, 150.18),
    ),
}

HALF_WORLD = 20037508.342789244
CONTOUR_STEP = 100
W = 1600  # contour grid width, in SVG units


def merc(lat, lon):
    x = lon * HALF_WORLD / 180
    y = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * HALF_WORLD / math.pi
    return x, y


def heights(sheets, bbox, z):
    """The DEM on a web mercator grid of zoom-z pixels over bbox."""
    south, west, north, east = bbox
    px = 2 * HALF_WORLD / (256 * 2**z)
    x0, y1 = merc(north, west)
    x1, y0 = merc(south, east)
    w, h = math.ceil((x1 - x0) / px), math.ceil((y1 - y0) / px)
    out = np.full((h, w), np.nan, np.float32)
    for src in sheets:
        with rasterio.open(src) as ds:
            reproject(
                rasterio.band(ds, 1),
                out,
                src_crs="EPSG:28356",
                src_nodata=-9999.0,
                dst_transform=from_origin(x0, y1, px, px),
                dst_crs="EPSG:3857",
                dst_nodata=np.nan,
                init_dest_nodata=False,
                resampling=Resampling.bilinear,
            )
    missing = np.isnan(out).mean()
    if missing:
        sys.exit(
            f"{missing:.1%} of the area has no height: fetch the sheets that cover it"
        )
    return out.astype(np.float64), px


def contours(h, name, lat, lon):
    k = W / h.shape[1]
    levels = []
    for m in range(
        int(np.ceil(h.min() / CONTOUR_STEP) * CONTOUR_STEP),
        int(h.max()) + 1,
        CONTOUR_STEP,
    ):
        segs = []
        for c in find_contours(h, m):
            pts = [
                (round(x * k), round(y * k))
                for y, x in approximate_polygon(c, tolerance=0.7)
            ]
            pts = [q for i, q in enumerate(pts) if i == 0 or q != pts[i - 1]]
            if (
                len(pts) < 4
                or np.ptp([q[0] for q in pts]) + np.ptp([q[1] for q in pts]) < 14
            ):
                continue
            rel = "".join(
                f"{'' if dx < 0 else ' '}{dx}{'' if dy < 0 else ' '}{dy}"
                for dx, dy in ((b[0] - a[0], b[1] - a[1]) for a, b in pairwise(pts))
            )
            segs.append(f"M{pts[0][0]} {pts[0][1]}l" + rel.lstrip())
        levels.append({"m": m, "d": "".join(segs)})
    return {
        "name": name,
        "lat": lat,
        "lon": lon,
        "w": W,
        "h": round(h.shape[0] * k),
        "levels": levels,
    }


def normals(h, px_m):
    dy, dx = np.gradient(h, px_m)
    n = np.dstack([-dx, -dy, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    out = io.BytesIO()
    Image.fromarray(np.round((n * 0.5 + 0.5) * 255).astype(np.uint8)).save(
        out, "WEBP", quality=85, method=6
    )
    return out.getvalue()


# N NE E SE S SW W NW, as signInTerrain.ts reads them.
D8 = [(-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1)]


def flow(h):
    """Steepest descent over the surface with its hollows filled."""
    H, W_ = h.shape
    filled = np.full_like(h, np.inf)
    seen = np.zeros(h.shape, bool)
    queue = []
    for y in range(H):
        for x in range(W_) if y in (0, H - 1) else (0, W_ - 1):
            filled[y, x] = h[y, x]
            seen[y, x] = True
            heapq.heappush(queue, (h[y, x], y, x))
    while queue:
        z, y, x = heapq.heappop(queue)
        for dy, dx in D8:
            ny, nx = y + dy, x + dx
            if 0 <= ny < H and 0 <= nx < W_ and not seen[ny, nx]:
                seen[ny, nx] = True
                # A small rise, so a filled hollow still drains one way.
                filled[ny, nx] = max(h[ny, nx], z + 1e-3)
                heapq.heappush(queue, (filled[ny, nx], ny, nx))
    direction = np.full(h.shape, 255, np.uint8)
    best = np.zeros(h.shape)
    pad = np.pad(filled, 1, constant_values=np.inf)
    for i, (dy, dx) in enumerate(D8):
        drop = (filled - pad[1 + dy : 1 + dy + H, 1 + dx : 1 + dx + W_]) / math.hypot(
            dy, dx
        )
        better = drop > best + 1e-9
        direction[better] = i
        best[better] = drop[better]
    out = io.BytesIO()
    Image.fromarray(direction).save(out, "WEBP", lossless=True, quality=100, method=6)
    return out.getvalue()


def main():
    sheets_dir, out_dir, *keys = sys.argv[1:]
    sheets = []
    for z in sorted(glob.glob(os.path.join(sheets_dir, "*.zip"))):
        asc = next(n for n in zipfile.ZipFile(z).namelist() if n.endswith(".asc"))
        sheets.append(f"/vsizip/{z}/{asc}")
    for key in keys or AREAS:
        name, bbox = AREAS[key]
        lat, lon = (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2
        fine, _ = heights(sheets, bbox, 14)
        coarse, px = heights(sheets, bbox, 13)
        ground_px = px * math.cos(math.radians(lat))
        files = {
            # Indented as the repo's formatter (biome) writes JSON.
            f"{key}.json": json.dumps(
                contours(
                    gaussian(fine, sigma=1.2, preserve_range=True),
                    name,
                    round(lat, 3),
                    round(lon, 3),
                ),
                indent=2,
            ).encode()
            + b"\n",
            f"{key}Normals.webp": normals(
                gaussian(coarse, sigma=1.0, preserve_range=True), ground_px
            ),
            f"{key}Flow.webp": flow(gaussian(coarse, sigma=1.0, preserve_range=True)),
        }
        for file, data in files.items():
            with open(os.path.join(out_dir, file), "wb") as f:
                f.write(data)
        print(
            key,
            coarse.shape[::-1],
            ", ".join(f"{f} {len(d) // 1024} KB" for f, d in files.items()),
            flush=True,
        )


if __name__ == "__main__":
    main()
