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
out=${OUT:-$here/out}
fixtures=${FIXTURES:-$repo/shared/src/__fixtures__/sim-regions}
pmtiles=${PMTILES:-$(command -v pmtiles || true)}
image=logjam-topo-worker:sim-regions

[ -n "$pmtiles" ] || { echo "build.sh: the go-pmtiles binary is not on PATH; set PMTILES" >&2; exit 1; }
mkdir -p "$out" "$fixtures"

docker build -q -t "$image" "$repo/topo" >/dev/null

# No --network host or credentials: the builds read published hosts only.
exec docker run --rm --user "$(id -u):$(id -g)" -w /tmp \
  -v "$out:/out" -v "$fixtures:/fixtures" -v "$here:/sim:ro" \
  -v "$(readlink -f "$pmtiles"):/usr/local/bin/pmtiles:ro" \
  --entrypoint python3 "$image" /sim/build.py "$@"
