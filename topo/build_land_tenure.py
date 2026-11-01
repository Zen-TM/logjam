#!/usr/bin/env python3
"""
build_land_tenure.py
---------------------
The Land overlay's archive: the NSW Land Tenure layer as one vector PMTiles
file, which both clients draw and clip like the statewide contours. Run it by
hand when DPIRD publishes a new version.

Input  : the layer's File Geodatabase, unzipped, NOT committed. SEED's download
         link refuses a script, so it is fetched by hand from
         https://data.nsw.gov.au/data/dataset/nsw-land-tenure
Output : one PMTiles archive, for the path `NSW_LAND.archivePath` names in
         shared/src/nswLand.ts. README.md has the recipe.

tippecanoe, not `ogr2ogr -f MVT`: one feature of this layer has 18 million
vertices, and the OGR driver held so much of it in memory that a statewide run
did not finish on 14 GB. Each zoom is coalesced, so a tile holds one polygon
per run of a class, not one per lot, and the map draws no cadastre.
"""

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Iterable, List, Set

SOURCE_LAYER = "land"
ATTRIBUTE = "TenureClass"
ZMIN = 8
ZMAX = 13
# `LAND_TILE_MARGIN_PX` in shared/src/nswLand.ts, at 256 units to a tile
# (test_land_tenure.py).
BUFFER = 5
CREDIT = (
    "NSW Land Tenure, December 2024 v2 © State of New South Wales (Department of"
    " Primary Industries and Regional Development), CC BY 4.0"
)
# `LAND_CLASSES` in shared/src/nswLand.ts (test_land_tenure.py). A client draws
# nothing for a class it doesn't know, so a new one has to stop the build.
TENURE_CLASSES = (
    "Private",
    "National Park",
    "State Forest",
    "Crownland-Leasehold",
    "Crownland-Other",
    "Indigenous Owned",
    "Unresolved Tenure",
)


def classes_in(ogrinfo_output: str) -> Set[str]:
    """The values `ogrinfo -sql "SELECT DISTINCT ..."` printed."""
    return set(re.findall(rf"{ATTRIBUTE} \(String\) = (.+)", ogrinfo_output))


def unknown_classes(found: Iterable[str]) -> List[str]:
    return sorted(set(found) - set(TENURE_CLASSES))


def flatgeobuf_command(gdb: Path, layer: str, out: Path) -> List[str]:
    return [
        *["ogr2ogr", "-q", "-f", "FlatGeobuf", str(out), str(gdb), layer],
        # The file is in NSW Lambert, whatever its listing says.
        *["-t_srs", "EPSG:4326", "-nln", SOURCE_LAYER],
        *["-nlt", "MULTIPOLYGON", "-dim", "XY", "-select", ATTRIBUTE],
        *["-lco", "SPATIAL_INDEX=NO"],
    ]


def tippecanoe_command(fgb: Path, out: Path, tmp: Path) -> List[str]:
    return [
        *["tippecanoe", "--force", "-o", str(out), "-t", str(tmp)],
        *["-l", SOURCE_LAYER, f"-Z{ZMIN}", f"-z{ZMAX}", "-y", ATTRIBUTE],
        *["-n", "NSW Land Tenure", "-N", CREDIT],
        # One polygon per run of a class, with shared edges kept shared.
        *["--coalesce", "--reorder", "--detect-shared-borders"],
        # tippecanoe's default, said because a client's borders rely on it: past
        # this a line pushed in from a tile's clipped edge shows in the tile.
        f"--buffer={BUFFER}",
        # Every lot stays at z13, where the lines are about a metre.
        "--simplify-only-low-zooms",
        # A dropped polygon is land with no answer, not a thinner map.
        *["--no-tiny-polygon-reduction", "--no-feature-limit"],
        "--no-tile-size-limit",
        str(fgb),
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("gdb", type=Path, help="the unzipped .gdb directory")
    parser.add_argument("out", type=Path, help="the .pmtiles to write")
    parser.add_argument("--layer", default="NSW_LandTenure_DPI2024_v02")
    args = parser.parse_args()

    listed = subprocess.run(
        [
            *["ogrinfo", "-ro", "-q", str(args.gdb), "-sql"],
            f"SELECT DISTINCT {ATTRIBUTE} FROM {args.layer}",
        ],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    unknown = unknown_classes(classes_in(listed))
    if unknown:
        sys.exit(f"Classes no client knows: {unknown}. See TENURE_CLASSES.")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    work = args.out.resolve().with_suffix(".work")
    work.mkdir(exist_ok=True)
    fgb = work / "land.fgb"
    subprocess.run(
        flatgeobuf_command(args.gdb, args.layer, fgb),
        check=True,
        # A FileGDB's rings are wound by role, so OGR need not work out which
        # is a hole: slow on a feature this size, and it warns as much.
        env={**os.environ, "OGR_ORGANIZE_POLYGONS": "ONLY_CCW"},
    )
    subprocess.run(tippecanoe_command(fgb, args.out, work), check=True)
    fgb.unlink()
    work.rmdir()


if __name__ == "__main__":
    main()
