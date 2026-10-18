#!/usr/bin/env bash
# Fetches the public sample inputs that are too big to commit (an ELVIS LiDAR
# ZIP, an NSW topo GeoPDF sheet) from this repo's `sample-data-v1` release,
# checks each against scripts/sample-data.sha256, and prints its local path.
#
#   scripts/sample-data.sh <asset> [<asset> ...]
#   scripts/sample-data.sh --self-test
#
# Files land in $SAMPLE_DATA_DIR (default .cache/sample-data at the repo
# root, gitignored) and are reused while their hash still matches. The
# release notes list each asset's source and licence. A changed file is a new
# release (`sample-data-v2`) and a new manifest line, never an asset replaced
# in place: the hash would stop matching for every older commit. Every release
# is a full snapshot (it re-uploads the assets it keeps), so a new release
# also bumps BASE_URL below.
#
# Mutation that turns the self-test red: dropping the hash check (the
# `sha256sum -c`) lets "a corrupt download fails" pass the bad file.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="${SAMPLE_DATA_MANIFEST:-$ROOT/scripts/sample-data.sha256}"
BASE_URL="${SAMPLE_DATA_BASE_URL:-https://github.com/Zen-TM/logjam/releases/download/sample-data-v1}"
DIR="${SAMPLE_DATA_DIR:-$ROOT/.cache/sample-data}"

# GNU coreutils on Linux; macOS ships only shasum.
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }

fetch() {
  local name=$1 line
  line=$(awk -v n="$name" '$2 == n' "$MANIFEST")
  [ -n "$line" ] || {
    echo "unknown sample asset '$name' (see $MANIFEST)" >&2; return 1
  }
  mkdir -p "$DIR"
  if ! (cd "$DIR" && sha256 -c --status <<<"$line" >/dev/null 2>&1); then
    curl -fsSL --retry 3 -o "$DIR/$name.part" "$BASE_URL/$name"
    mv "$DIR/$name.part" "$DIR/$name"
    (cd "$DIR" && sha256 -c --status <<<"$line") || {
      rm -f "$DIR/$name"; echo "sha256 mismatch for $name" >&2; return 1
    }
  fi
  echo "$DIR/$name"
}

self_test() {
  local tmp fails=0
  tmp=$(mktemp -d)
  mkdir "$tmp/served"
  echo good > "$tmp/served/good.bin"
  echo corrupt > "$tmp/served/bad.bin"
  # Both lines carry the hash of "good": bad.bin is served with other bytes.
  local hash
  hash=$(sha256 < "$tmp/served/good.bin" | cut -d' ' -f1)
  printf '%s  good.bin\n%s  bad.bin\n' "$hash" "$hash" > "$tmp/manifest"
  run() { SAMPLE_DATA_MANIFEST="$tmp/manifest" SAMPLE_DATA_BASE_URL="file://$tmp/served" SAMPLE_DATA_DIR="$tmp/out" "$0" "$@"; }
  check() { if [ "$2" = "$3" ]; then echo "ok   — $1"; else echo "FAIL — $1: want $2, got $3"; fails=1; fi; }
  run good.bin >/dev/null 2>&1; check "a good download passes" 0 $?
  run bad.bin >/dev/null 2>&1; check "a corrupt download fails" 1 $?
  [ ! -e "$tmp/out/bad.bin" ]; check "a corrupt download is not kept" 0 $?
  run nope.bin >/dev/null 2>&1; check "an unknown asset fails" 1 $?
  rm -rf "$tmp"
  return $fails
}

if [ "${1:-}" = --self-test ]; then set +e; self_test; exit; fi
[ $# -gt 0 ] || { sed -n '2,7p' "$0" >&2; exit 2; }
for name in "$@"; do fetch "$name"; done
