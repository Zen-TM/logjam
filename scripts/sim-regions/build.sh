#!/usr/bin/env bash
# Builds the simulated regions' archives in the topo worker image. See README.md.
#
#   build.sh [--only simnz,simutah,world] [--step heights,slope,contours,vector,places,lidar]
#            [--fixtures] [--force] [--protomaps-build 20261113]
#   build.sh up
#
# The build needs docker and the go-pmtiles binary (PMTILES, default: `pmtiles`
# on PATH). OUT is where `master/` and the rest are written (default:
# scripts/sim-regions/out).
#
# `up` uploads every file under OUT/master/ to the dev stack's topo bucket
# (BUCKET_URL, default MiniStack's on :4566; another URL for a stack that serves
# S3 on a different port), so scripts/dev-master.mjs and DEV_MASTER_URL serve
# them. It needs only curl, and fails if there is nothing to upload or the
# bucket refuses a file. It sends MiniStack's dummy credentials, so it refuses
# any BUCKET_URL that is not on this machine.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)

if [ "${1:-}" = up ]; then
  bucket=${BUCKET_URL:-http://127.0.0.1:4566/logjam-topo-local}
  # Guard: simRegionsBuild.test.ts, "refuses a bucket that is not on this machine, before any upload".
  [[ $bucket =~ ^http://(127\.0\.0\.1|localhost):[0-9]+(/|$) ]] || {
    echo "build.sh up: BUCKET_URL must be http://127.0.0.1:<port>/... or http://localhost:<port>/...; this script sends test credentials and writes only to a local stack" >&2
    exit 1
  }
  out=${OUT:-$here/out}
  [ -d "$out/master" ] || { echo "build.sh up: nothing built at $out/master; run build.sh first" >&2; exit 1; }
  # No readlink -m here: BSD readlink on macOS lacks it.
  out=$(cd "$out" && pwd)
  count=0
  while IFS= read -r file; do
    key=${file#"$out"/}
    # test/test: MiniStack's dummy credentials, as in the README's Local Development.
    curl -fsS -u test:test --upload-file "$file" "${bucket%/}/$key" >/dev/null
    echo "uploaded $key"
    count=$((count + 1))
  done < <(find "$out/master" -type f -name '*.pmtiles' | sort)
  [ "$count" -gt 0 ] || { echo "build.sh up: no .pmtiles under $out/master" >&2; exit 1; }
  exit 0
fi

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
