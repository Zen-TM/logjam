#!/usr/bin/env bash
# Builds the simulated regions' archives in the topo worker image. See README.md.
#
#   build.sh [--only simnz,simutah,world] [--step heights,slope,contours,vector,places,lidar]
#            [--fixtures] [--force] [--protomaps-build 20261113]
#
# Needs docker and the go-pmtiles binary (PMTILES, default: `pmtiles` on PATH).
# OUT is where `master/` and the rest are written (default: scripts/sim-regions/out).
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
# Absolute: docker reads a relative path in -v as a named volume.
out=$(readlink -m "${OUT:-$here/out}")
fixtures=$(readlink -m "${FIXTURES:-$repo/shared/src/__fixtures__/sim-regions}")
pmtiles=$(readlink -f "${PMTILES:-$(command -v pmtiles || true)}")
image=logjam-topo-worker:sim-regions

# A file, so docker does not create a root-owned directory where a wrong path was.
[ -f "$pmtiles" ] || { echo "build.sh: no go-pmtiles binary at '${PMTILES:-pmtiles on PATH}'; set PMTILES to its path" >&2; exit 1; }
mkdir -p "$out" "$fixtures"

docker build -q -t "$image" "$repo/topo" >/dev/null

# No --network host or credentials: the builds read published hosts only.
exec docker run --rm --user "$(id -u):$(id -g)" -w /tmp \
  -v "$out:/out" -v "$fixtures:/fixtures" -v "$here:/sim:ro" \
  -v "$pmtiles:/usr/local/bin/pmtiles:ro" \
  --entrypoint python3 "$image" /sim/build.py "$@"
