#!/usr/bin/env bash
# Regenerate the bundled basemap preview tiles (src/map/BasemapThumb.tsx).
#
# One tile per raster source over Katoomba — z13 x7516 y4911 — downscaled to
# 128px PNG. Six requests total, not a scrape; every source here is licensed
# for redistribution with credit (see BASEMAP_THUMB_CREDIT).
#
# PNG, not WEBP: the set shipped as WEBP and the thumbnails intermittently
# rendered blank on-device (see BasemapThumb.tsx). Keep it PNG so Fresco decodes
# it on every handset.
#
# `protomaps` is a vector style with no tile to fetch. Its sample is a
# screenshot of the app rendering it:
#   adb exec-out screencap -p > /tmp/shot.png
#   python3 -c "from PIL import Image; Image.open('/tmp/shot.png').crop((412,900,924,1412)).resize((128,128)).save('assets/basemap-thumbs/protomaps.png')"
#
# Needs: curl, python3 with Pillow.
set -euo pipefail

cd "$(dirname "$0")/.."
OUT=assets/basemap-thumbs
mkdir -p "$OUT"

Z=13
X=7516
Y=4911
# A UA that names the app and offers a contact. Not optional for the OSM
# family: an unidentified client is served a 200 carrying an "Access blocked"
# IMAGE, which downscales into a perfectly convincing broken thumbnail.
UA="Logjam/0.1 (+https://github.com/logjam-nsw/logjam) one-off sample tile for an in-app basemap preview"

fetch() {
  curl -sSf -A "$UA" -o "$OUT/$1.raw" "$2"
}

SIX=https://maps.six.nsw.gov.au/arcgis/rest/services/public
fetch six-topo    "$SIX/NSW_Topo_Map/MapServer/tile/$Z/$Y/$X"
fetch six-base    "$SIX/NSW_Base_Map/MapServer/tile/$Z/$Y/$X"
fetch six-imagery "$SIX/NSW_Imagery/MapServer/tile/$Z/$Y/$X"
fetch osm-topo    "https://a.tile.opentopomap.org/$Z/$X/$Y.png"
fetch osm-cycle   "https://a.tile-cyclosm.openstreetmap.fr/cyclosm/$Z/$X/$Y.png"

python3 - "$OUT" <<'PY'
import os, sys
from PIL import Image

out = sys.argv[1]
for name in os.listdir(out):
    if not name.endswith(".raw"):
        continue
    stem = name[: -len(".raw")]
    path = os.path.join(out, name)
    Image.open(path).convert("RGB").resize((128, 128), Image.LANCZOS).save(
        os.path.join(out, f"{stem}.png"), "PNG", optimize=True
    )
    os.remove(path)
PY

ls -l "$OUT"
